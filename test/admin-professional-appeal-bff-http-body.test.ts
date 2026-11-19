import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createConnection} from 'node:net';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {APPEAL_BFF_HTTP_BOUNDARY,PlatformProfessionalAppealBffController} from
 '../src/modules/admin/admin-professional-appeal-bff-http.controller.js';
import {createAppealBffRedisNetworkRateMiddleware} from
 '../src/modules/admin/admin-professional-appeal-bff-redis-network-rate.js';
import {appealBffHttpBodyPreflight,appealBffHttpParserError,APPEAL_BFF_MAX_JSON_BYTES} from
 '../src/modules/admin/admin-professional-appeal-bff-http-body.middleware.js';

const expressJson=(createRequire(process.cwd()+'/package.json')('express') as {
 json:(options:{type:string;limit:string;inflate:boolean})=>(...args:unknown[])=>unknown;
}).json;

test('isolated Nest BFF HTTP rejects oversized, malformed and compressed JSON before BFF adapters',async()=>{
 const flag='SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP',previous=process.env[flag];
 const origin='https://admin.example.kz',id=randomUUID();
 const cookie='__Host-services-appeal-session='+randomBytes(32).toString('base64url');
 let issued=0,mutated=0;
 @Module({controllers:[PlatformProfessionalAppealBffController],providers:[{
  provide:APPEAL_BFF_HTTP_BOUNDARY,
  useValue:{
   expectedOrigin:origin,
   issueCsrf:async()=>{issued++;return {token:'test-only'};},
   mutate:async()=>{mutated++;return {ok:true};},
  },
 }]})
 class BffTestModule{}
 const app=await NestFactory.create(BffTestModule,{logger:false});
 try{
  app.use(appealBffHttpBodyPreflight);
  app.use(expressJson({type:'application/json',limit:APPEAL_BFF_MAX_JSON_BYTES+'b',inflate:false}));
  app.use(appealBffHttpParserError);
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const base=(await app.getUrl())+'/v1/admin/bff/moderation/appeals/'+id+'/decision/csrf';
  const headers={Origin:origin,'Sec-Fetch-Site':'same-origin',Cookie:cookie,
   'Content-Type':'application/json'};
  const post=(body:string,h:Record<string,string>={})=>fetch(base,{
   method:'POST',headers:{...headers,...h},body,redirect:'manual',
  });
  process.env[flag]='enabled';
  const tooLarge=await post(JSON.stringify({payload:'x'.repeat(5000)}));
  assert.equal(tooLarge.status,413);
  assert.deepEqual(await tooLarge.json(),{statusCode:413,message:'Payload Too Large'});
  assert.match(tooLarge.headers.get('cache-control')??'',/no-store/);
  assert.equal(tooLarge.headers.get('x-content-type-options'),'nosniff');
  const malformed=await post('{"broken":');
  assert.equal(malformed.status,400);
  assert.deepEqual(await malformed.json(),{statusCode:400,message:'Bad Request'});
  const unsupported=await post('{}',{'Content-Encoding':'gzip'});
  assert.equal(unsupported.status,415);
  assert.deepEqual(await unsupported.json(),{statusCode:415,message:'Unsupported Media Type'});
  const charset=await post('{}',{'Content-Type':'application/json; charset=iso-8859-1'});
  assert.equal(charset.status,415);
  const valid=await post('{}');
  assert.equal(valid.status,200);
  assert.deepEqual(await valid.json(),{token:'test-only'});
  assert.equal(issued,1);
  assert.equal(mutated,0);
  process.env[flag]='disabled';
  assert.equal((await post('{}')).status,401,'feature flag must still deny valid body');
 }finally{
  await app.close();
  if(previous===undefined)delete process.env[flag];else process.env[flag]=previous;
 }
});

test('BFF body middleware fails closed on invalid declared sizes and passes unrelated endpoints',()=>{
 const seen:{status?:number;body?:unknown}={};
 const headers:Record<string,string>={};
 const res={
  setHeader:(key:string,value:string)=>{headers[key]=value;},
  status:(code:number)=>{seen.status=code;return {json:(body:unknown)=>{seen.body=body;}};},
 };
 let next=0;
 const path='/v1/admin/bff/moderation/appeals/'+randomUUID()+'/decision';
 const req=(extra:Record<string,string|string[]|undefined>,originalUrl=path)=>({
  method:'POST',originalUrl,headers:{'content-type':'application/json',...extra},
 });
 const invalidCases:Array<[Record<string,string|string[]|undefined>,number]>=[
  [{'content-length':'999999999'},413],
  [{'content-length':'-1'},400],
  [{'content-length':'4, 5'},400],
  [{'content-length':['4','5']},400],
  [{'content-encoding':'br'},415],
  [{'content-type':'text/plain'},415],
 ];
 for(const [extra,expected] of invalidCases){
  seen.status=undefined;
  appealBffHttpBodyPreflight(req(extra),res,()=>{next++;});
  assert.equal(seen.status,expected);
 }
 assert.equal(next,0);
 appealBffHttpBodyPreflight(req({'content-length':'17'}),res,()=>{next++;});
 appealBffHttpBodyPreflight(req({},'/v1/public/other'),res,()=>{next++;});
 assert.equal(next,2);
 let forwarded=0;
 appealBffHttpParserError({type:'other'},req({}),res,()=>{forwarded++;});
 assert.equal(forwarded,1,'unknown errors are never rewritten as parser problems');
});

test('isolated Nest HTTP enforces shared Redis gate before body parsing and BFF adapters',async()=>{
 const flag='SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP',previous=process.env[flag];
 const id=randomUUID(),origin='https://admin.example.kz';
 let issued=0,redisCalls=0;
 @Module({controllers:[PlatformProfessionalAppealBffController],providers:[{
  provide:APPEAL_BFF_HTTP_BOUNDARY,
  useValue:{
   expectedOrigin:origin,
   issueCsrf:async()=>{issued++;return {token:'test-only'};},
   mutate:async()=>({ok:true}),
  },
 }]})
 class RateTestModule{}
 const app=await NestFactory.create(RateTestModule,{logger:false});
 try{
  const redis={eval:async()=>++redisCalls};
  app.use(createAppealBffRedisNetworkRateMiddleware(redis,randomBytes(32)));
  app.use(appealBffHttpBodyPreflight);
  app.use(expressJson({type:'application/json',limit:APPEAL_BFF_MAX_JSON_BYTES+'b',inflate:false}));
  app.use(appealBffHttpParserError);
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const url=(await app.getUrl())+'/v1/admin/bff/moderation/appeals/'+id+'/decision/csrf';
  const post=()=>fetch(url,{method:'POST',headers:{
   Origin:origin,'Sec-Fetch-Site':'same-origin',
   'Content-Type':'application/json',
  },body:'{"malformed":',redirect:'manual'});
  process.env[flag]='enabled';
  for(let i=0;i<20;i++){
   const response=await post();
   assert.equal(response.status,400,'parser must handle allowed malformed JSON');
  }
  const exhausted=await post();
  assert.equal(exhausted.status,429,'network gate must deny before parsing');
  assert.deepEqual(await exhausted.json(),{statusCode:429,message:'Too Many Requests'});
  assert.equal(exhausted.headers.get('retry-after'),'60');
  assert.match(exhausted.headers.get('cache-control')??'',/no-store/);
  assert.equal(redisCalls,21);
  assert.equal(issued,0,'malformed and limited requests never reach privileged adapters');

  redis.eval=async()=>{throw Error('test Redis unavailable');};
  const unavailable=await post();
  assert.equal(unavailable.status,503,'Redis outage must deny before parsing');
  assert.deepEqual(await unavailable.json(),{statusCode:503,message:'Service Unavailable'});
  assert.equal(issued,0);
 }finally{
  await app.close();
  if(previous===undefined)delete process.env[flag];else process.env[flag]=previous;
 }
});

test('isolated Nest HTTP denies stalled Redis before parsing and cannot resume on late success',async()=>{
 const flag='SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP',previous=process.env[flag];
 const origin='https://admin.example.kz',id=randomUUID();
 let issued=0,mutated=0;
 let resolveRedis:((value:number)=>void)|undefined;
 const unresolved=new Promise<number>(resolve=>{resolveRedis=resolve;});
 @Module({controllers:[PlatformProfessionalAppealBffController],providers:[{
  provide:APPEAL_BFF_HTTP_BOUNDARY,
  useValue:{
   expectedOrigin:origin,
   issueCsrf:async()=>{issued++;return {token:'test-only'};},
   mutate:async()=>{mutated++;return {ok:true};},
  },
 }]})
 class StalledRedisModule{}
 const app=await NestFactory.create(StalledRedisModule,{logger:false});
 try{
  app.use(createAppealBffRedisNetworkRateMiddleware({eval:()=>unresolved},randomBytes(32)));
  app.use(appealBffHttpBodyPreflight);
  app.use(expressJson({type:'application/json',limit:APPEAL_BFF_MAX_JSON_BYTES+'b',inflate:false}));
  app.use(appealBffHttpParserError);
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const url=(await app.getUrl())+'/v1/admin/bff/moderation/appeals/'+id+'/decision/csrf';
  process.env[flag]='enabled';
  const start=Date.now();
  const response=await fetch(url,{method:'POST',headers:{
   Origin:origin,'Sec-Fetch-Site':'same-origin',
   'Content-Type':'application/json',
  },body:'{"malformed":',redirect:'manual'});
  const elapsed=Date.now()-start;
  assert.equal(response.status,503,'Redis timeout must deny before malformed JSON parser');
  assert.deepEqual(await response.json(),{statusCode:503,message:'Service Unavailable'});
  assert.match(response.headers.get('cache-control')??'',/no-store/);
  assert.ok(elapsed>=2_500,'request must be held until the rate gate deadline');
  assert.ok(elapsed<10_000,'network request must not hang indefinitely');
  assert.equal(issued,0);
  assert.equal(mutated,0);
  resolveRedis?.(1);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(issued,0,'late Redis success must never issue a CSRF proof');
  assert.equal(mutated,0,'late Redis success must never mutate');
 }finally{
  await app.close();
  if(previous===undefined)delete process.env[flag];else process.env[flag]=previous;
 }
});

test('isolated Nest BFF network quota ignores spoofed forwarding headers',async()=>{
 const flag='SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP',previous=process.env[flag];
 const origin='https://admin.example.kz',id=randomUUID();
 let issued=0;
 const usedKeys:string[]=[];
 @Module({controllers:[PlatformProfessionalAppealBffController],providers:[{
  provide:APPEAL_BFF_HTTP_BOUNDARY,
  useValue:{
   expectedOrigin:origin,
   issueCsrf:async()=>{issued++;return {token:'test-only'};},
   mutate:async()=>({ok:true}),
  },
 }]})
 class ForwardingHeaderModule{}
 const app=await NestFactory.create(ForwardingHeaderModule,{logger:false});
 try{
  const redis={eval:async(_script:string,options:{keys:string[];arguments:string[]})=>{
   usedKeys.push(options.keys[0]!);
   return usedKeys.length;
  }};
  app.use(createAppealBffRedisNetworkRateMiddleware(redis,randomBytes(32)));
  app.use(appealBffHttpBodyPreflight);
  app.use(expressJson({type:'application/json',limit:APPEAL_BFF_MAX_JSON_BYTES+'b',inflate:false}));
  app.use(appealBffHttpParserError);
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const url=(await app.getUrl())+'/v1/admin/bff/moderation/appeals/'+id+'/decision/csrf';
  process.env[flag]='enabled';
  for(let i=0;i<21;i++){
   const resp=await fetch(url,{method:'POST',headers:{
    Origin:origin,'Sec-Fetch-Site':'same-origin',
    'Content-Type':'application/json',
    'X-Forwarded-For':'198.51.100.'+(i+1),
    'X-Real-IP':'203.0.113.'+(i+1),
    'Forwarded':'for=192.0.2.'+(i+1),
   },body:'{"broken":',redirect:'manual'});
   assert.equal(resp.status,i===20?429:400);
  }
  assert.equal(usedKeys.length,21);
  assert.equal(new Set(usedKeys).size,1,'all spoofed headers must share direct TCP peer quota');
  assert.match(usedKeys[0]!,/^services:appeal-bff:net-rate:v1:[a-f0-9]{64}$/);
  assert.equal(issued,0);
 }finally{
  await app.close();
  if(previous===undefined)delete process.env[flag];else process.env[flag]=previous;
 }
});

async function realRedisRateEval(script:string,options:{keys:string[];arguments:string[]}):Promise<number>{
 const host=process.env.APPEAL_CSRF_REDIS_HOST??'127.0.0.1';
 const port=Number(process.env.APPEAL_CSRF_REDIS_PORT??6379);
 const args=['EVAL',script,String(options.keys.length),...options.keys,...options.arguments];
 const command='*'+args.length+'\r\n'+args.map(arg=>
  '$'+Buffer.byteLength(arg)+'\r\n'+arg+'\r\n').join('');
 return new Promise<number>((resolve,reject)=>{
  const socket=createConnection({host,port});
  let finished=false,buffer='';
  const finish=(error:Error|null,value?:number)=>{
   if(finished)return;
   finished=true;socket.destroy();
   if(error)reject(error);else resolve(value!);
  };
  socket.setTimeout(3000,()=>finish(Error('Redis response timeout')));
  socket.on('error',error=>finish(error));
  socket.on('connect',()=>socket.write(command));
  socket.on('data',(chunk:Buffer)=>{
   buffer+=chunk.toString('utf8');
   const end=buffer.indexOf('\r\n');
   if(end<0)return;
   const reply=buffer.slice(0,end);
   if(/^:[0-9]+$/.test(reply))finish(null,Number(reply.slice(1)));
   else finish(Error('Redis unexpected response'));
  });
  socket.on('end',()=>{if(!finished)finish(Error('Redis closed without response'));});
 });
}

test('real Redis atomic quota applies to 30 concurrent Nest HTTP requests',async()=>{
 const flag='SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP',previous=process.env[flag];
 const origin='https://admin.example.kz',id=randomUUID();
 let privilegedCalls=0;
 @Module({controllers:[PlatformProfessionalAppealBffController],providers:[{
  provide:APPEAL_BFF_HTTP_BOUNDARY,
  useValue:{
   expectedOrigin:origin,
   issueCsrf:async()=>{privilegedCalls++;return {token:'test-only'};},
   mutate:async()=>{privilegedCalls++;return {ok:true};},
  },
 }]})
 class RealRedisHttpModule{}
 const app=await NestFactory.create(RealRedisHttpModule,{logger:false});
 try{
  app.use(createAppealBffRedisNetworkRateMiddleware({eval:realRedisRateEval},randomBytes(32)));
  app.use(appealBffHttpBodyPreflight);
  app.use(expressJson({type:'application/json',limit:APPEAL_BFF_MAX_JSON_BYTES+'b',inflate:false}));
  app.use(appealBffHttpParserError);
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const url=(await app.getUrl())+'/v1/admin/bff/moderation/appeals/'+id+'/decision/csrf';
  process.env[flag]='enabled';
  const statuses=await Promise.all(Array.from({length:30},async()=>{
   const response=await fetch(url,{method:'POST',headers:{
    Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',
   },body:'{"invalid":',redirect:'manual'});
   return response.status;
  }));
  assert.equal(statuses.filter(status=>status===400).length,20);
  assert.equal(statuses.filter(status=>status===429).length,10);
  assert.equal(privilegedCalls,0,'invalid or limited requests cannot reach privileged adapters');
 }finally{
  await app.close();
  if(previous===undefined)delete process.env[flag];else process.env[flag]=previous;
 }
});
