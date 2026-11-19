import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {createConnection} from 'node:net';
import {
 createAppealBffRedisNetworkRateMiddleware,APPEAL_BFF_RATE_LUA,
} from '../src/modules/admin/admin-professional-appeal-bff-redis-network-rate.js';

type Response={status:number;body:unknown;headers:Record<string,string>;next:boolean};
function invoke(
 middleware:ReturnType<typeof createAppealBffRedisNetworkRateMiddleware>,
 ip:string,overrides:Record<string,unknown>={},
):Promise<Response>{
 return new Promise(resolve=>{
  const state:Response={status:0,body:null,headers:{},next:false};
  const res={
   setHeader:(name:string,value:string)=>{state.headers[name.toLowerCase()]=value;},
   status:(status:number)=>{state.status=status;return {
    json:(body:unknown)=>{state.body=body;resolve(state);},
   };},
  };
  middleware({method:'POST',
   originalUrl:'/v1/admin/bff/moderation/appeals/123/decision/csrf',
   socket:{remoteAddress:ip},...overrides},res,()=>{state.next=true;resolve(state);});
 });
}
function createFakeRedis(){
 const hits=new Map<string,number>();
 const redis={eval:async(script:string,options:{keys:string[];arguments:string[]})=>{
  assert.equal(script,APPEAL_BFF_RATE_LUA);
  assert.deepEqual(options.arguments,['60000']);
  assert.match(options.keys[0]??'',/^services:appeal-bff:net-rate:v1:[a-f0-9]{64}$/);
  const key=options.keys[0]!;
  const count=(hits.get(key)??0)+1;
  hits.set(key,count);
  return count;
 }};
 return {redis,hits};
}

test('prepared BFF limiter permits 20 requests per socket peer, denies excess and never stores raw IP',async()=>{
 const flag='SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP',old=process.env[flag];
 const secret=randomBytes(32),{redis,hits}=createFakeRedis();
 const limit=createAppealBffRedisNetworkRateMiddleware(redis,secret);
 try{
  process.env[flag]='enabled';
  const requests=await Promise.all(Array.from({length:25},
   ()=>invoke(limit,'198.51.100.24')));
  assert.equal(requests.filter(x=>x.next).length,20);
  assert.equal(requests.filter(x=>x.status===429).length,5);
  assert.ok(requests.filter(x=>x.status===429).every(x=>
   x.headers['retry-after']==='60'&&x.headers['cache-control']?.includes('no-store')));
  assert.equal((await invoke(limit,'198.51.100.25')).next,true,'other peer has own budget');
  assert.equal(hits.size,2);
  assert.ok([...hits.keys()].every(k=>!k.includes('198.51')));
  process.env[flag]='disabled';
  const before=hits.size;
  assert.equal((await invoke(limit,'198.51.100.24')).next,true,'disabled route bypasses Redis');
  assert.equal(hits.size,before);
 }finally{
  if(old===undefined)delete process.env[flag];else process.env[flag]=old;
 }
});

test('BFF limiter fails closed on missing key, missing peer, Redis failure or invalid reply',async()=>{
 const flag='SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP',old=process.env[flag];
 process.env[flag]='enabled';
 try{
  const secret=randomBytes(32);
  const unavailable={eval:async()=>{throw Error('redis unavailable');}};
  const invalid={eval:async()=>null};
  for(const [redis,key,ip] of [
   [unavailable,secret,'127.0.0.1'],
   [invalid,secret,'127.0.0.1'],
   [unavailable,Buffer.alloc(0),'127.0.0.1'],
   [unavailable,secret,''],
  ] as const){
   const state=await invoke(createAppealBffRedisNetworkRateMiddleware(redis,key),ip);
   assert.equal(state.status,503);
   assert.equal(state.next,false);
   assert.deepEqual(state.body,{statusCode:503,message:'Service Unavailable'});
  }
  let calls=0;
  const middleware=createAppealBffRedisNetworkRateMiddleware({
   eval:async()=>{calls++;return 1;},
  },secret);
  assert.equal((await invoke(middleware,'127.0.0.1',{
   originalUrl:'/v1/health',
  })).next,true);
  assert.equal((await invoke(middleware,'127.0.0.1',{method:'GET'})).next,true);
  assert.equal(calls,0);
 }finally{
  if(old===undefined)delete process.env[flag];else process.env[flag]=old;
 }
});

function redisEval(script:string,options:{keys:string[];arguments:string[]}):Promise<number>{
 const host=process.env.APPEAL_CSRF_REDIS_HOST??'127.0.0.1';
 const port=Number(process.env.APPEAL_CSRF_REDIS_PORT??6379);
 const args=['EVAL',script,String(options.keys.length),...options.keys,...options.arguments];
 const payload='*'+args.length+'\r\n'+args.map(arg=>
  '$'+Buffer.byteLength(arg)+'\r\n'+arg+'\r\n').join('');
 return new Promise((resolve,reject)=>{
  const socket=createConnection({host,port});
  let finished=false,buffer='';
  const finish=(error:Error|null,value=0)=>{
   if(finished)return;finished=true;socket.destroy();
   if(error)reject(error);else resolve(value);
  };
  socket.setTimeout(5000,()=>finish(Error('Redis timeout')));
  socket.on('error',error=>finish(error));
  socket.on('connect',()=>socket.write(payload));
  socket.on('data',(chunk:Buffer)=>{
   buffer+=chunk.toString('utf8');
   const end=buffer.indexOf('\r\n');
   if(end<0)return;
   const reply=buffer.slice(0,end);
   if(/^:[0-9]+$/.test(reply))finish(null,Number(reply.slice(1)));
   else finish(Error('Unexpected Redis EVAL reply'));
  });
  socket.on('end',()=>{if(!finished)finish(Error('Redis closed before reply'));});
 });
}

test('live Redis shares the BFF rate cap across 30 independently connected requests',async()=>{
 const flag='SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP',old=process.env[flag];
 process.env[flag]='enabled';
 try{
  const secret=randomBytes(32),middleware=createAppealBffRedisNetworkRateMiddleware(
   {eval:redisEval},secret);
  const results=await Promise.all(Array.from({length:30},
   ()=>invoke(middleware,'192.0.2.199')));
  assert.equal(results.filter(x=>x.next).length,20);
  assert.equal(results.filter(x=>x.status===429).length,10);
  assert.equal((await invoke(middleware,'192.0.2.199')).status,429);
  assert.equal((await invoke(middleware,'192.0.2.200')).next,true);
 }finally{
  if(old===undefined)delete process.env[flag];else process.env[flag]=old;
 }
});

test('mapped IPv4 and plain IPv4 share one rate quota; malformed peers fail closed',async()=>{
 const flag='SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP',old=process.env[flag];
 process.env[flag]='enabled';
 try{
  const {redis,hits}=createFakeRedis();
  const limit=createAppealBffRedisNetworkRateMiddleware(redis,randomBytes(32));
  const combined=await Promise.all([
   ...Array.from({length:12},()=>invoke(limit,'203.0.113.9')),
   ...Array.from({length:13},()=>invoke(limit,'::ffff:203.0.113.9')),
  ]);
  assert.equal(combined.filter(x=>x.next).length,20);
  assert.equal(combined.filter(x=>x.status===429).length,5);
  assert.equal(hits.size,1,'mapped and plain addresses use same Redis key');
  for(const peer of ['not-an-ip','203.0.113.999','203.0.113.9:80','fe80::invalid']){
   const priorCount: number=hits.size;
   const denied=await invoke(limit,peer);
   assert.equal(denied.status,503,peer);
   assert.equal(denied.next,false);
   assert.equal(hits.size,priorCount,'invalid peer must not reach Redis');
  }
 }finally{
  if(old===undefined)delete process.env[flag];else process.env[flag]=old;
 }
});

test('equivalent IPv6 encodings and mapped IPv4 hex form cannot split a quota',async()=>{
 const flag='SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP',old=process.env[flag];
 process.env[flag]='enabled';
 try{
  const {redis,hits}=createFakeRedis();
  const gate=createAppealBffRedisNetworkRateMiddleware(redis,randomBytes(32));
  const sameV6=[
   '2001:db8::1','2001:0DB8:0000:0000:0000:0000:0000:0001',
   '2001:DB8:0:0:0:0:0:1',
  ];
  const responses=await Promise.all(Array.from({length:24},(_,i)=>
   invoke(gate,sameV6[i%sameV6.length]!)));
  assert.equal(responses.filter(x=>x.next).length,20);
  assert.equal(responses.filter(x=>x.status===429).length,4);
  assert.equal(hits.size,1,'equivalent IPv6 strings share a Redis key');

  const mapped=await Promise.all(Array.from({length:23},(_,i)=>invoke(gate,
   ['203.0.113.9','::ffff:203.0.113.9','::FFFF:CB00:7109'][i%3]!)));
  assert.equal(mapped.filter(x=>x.next).length,20);
  assert.equal(mapped.filter(x=>x.status===429).length,3);
  assert.equal(hits.size,2,'both mapped IPv6 spellings share the IPv4 quota');
 }finally{
  if(old===undefined)delete process.env[flag];else process.env[flag]=old;
 }
});
