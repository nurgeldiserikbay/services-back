import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createConnection} from 'node:net';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createAppealBffRedisCsrfClaim} from '../src/modules/admin/admin-professional-appeal-bff-redis-claim.js';

// Real Redis protocol transport for this isolated test only. Production
// provisioning, TLS, ACLs and client lifecycle are separate release gates.
function redisSet(key:string,value:string,options:{NX:true;PX:number}):Promise<string|null>{
 const host=process.env.APPEAL_CSRF_REDIS_HOST??'127.0.0.1';
 const port=Number(process.env.APPEAL_CSRF_REDIS_PORT??6379);
 const args=['SET',key,value,'NX','PX',String(options.PX)];
 const payload='*'+args.length+'\r\n'+args.map(arg=>'$'+Buffer.byteLength(arg)+'\r\n'+arg+'\r\n').join('');
 return new Promise((resolve,reject)=>{
  const socket=createConnection({host,port});
  let settled=false,buffer='';
  const finish=(err:Error|null,result:string|null=null)=>{
   if(settled)return;settled=true;socket.destroy();
   if(err)reject(err);else resolve(result);
  };
  socket.setTimeout(4000,()=>finish(new Error('Redis test timeout')));
  socket.on('error',err=>finish(err));
  socket.on('connect',()=>socket.write(payload));
  socket.on('data',(chunk:Buffer)=>{
   buffer+=chunk.toString('utf8');
   const end=buffer.indexOf('\r\n');
   if(end<0)return;
   const response=buffer.slice(0,end);
   if(response==='+OK')finish(null,'OK');
   else if(response==='$-1')finish(null,null);
   else finish(new Error('Unexpected Redis protocol response: '+response.slice(0,64)));
  });
  socket.on('end',()=>{if(!settled)finish(new Error('Redis closed connection before response'));});
 });
}

test('real Redis accepts only one concurrently claimed CSRF across isolated clients',async()=>{
 const id=randomUUID(),digest=createHash('sha256').update(randomBytes(32)).digest('hex');
 const claim=createAppealBffRedisCsrfClaim({set:redisSet});
 const expires=Date.now()+60_000;
 const results=await Promise.all(Array.from({length:16},()=>claim(id,digest,expires)));
 assert.equal(results.filter(Boolean).length,1);
 assert.equal(results.filter(x=>!x).length,15);
 assert.equal(await claim(id,digest,expires),false);
 assert.equal(await claim(randomUUID(),digest,expires),true);
 const distinct=createHash('sha256').update(randomBytes(32)).digest('hex');
 assert.equal(await claim(id,distinct,expires),true);
});

test('real Redis claim expires and can be reclaimed after its TTL',async()=>{
 const id=randomUUID(),digest=createHash('sha256').update(randomBytes(32)).digest('hex');
 const claim=createAppealBffRedisCsrfClaim({set:redisSet});
 assert.equal(await claim(id,digest,Date.now()+1500),true);
 assert.equal(await claim(id,digest,Date.now()+1500),false);
 await new Promise(resolve=>setTimeout(resolve,1800));
 assert.equal(await claim(id,digest,Date.now()+1500),true);
});
