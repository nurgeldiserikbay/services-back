import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createConnection} from 'node:net';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createAppealBffRedisCsrfClaim} from '../src/modules/admin/admin-professional-appeal-bff-redis-claim.js';
import {issueAppealBffCsrfForSession} from '../src/modules/admin/admin-professional-appeal-bff-csrf-issuer.js';
import {executeAppealBffMutation} from '../src/modules/admin/admin-professional-appeal-bff-mutation.js';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {UnauthorizedException} from '@nestjs/common';

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

test('live Redis enforces one-use issued CSRF through BFF coordinator with session revocation',async()=>{
 const origin='https://admin.example.kz',appealId=randomUUID(),sessionId=randomUUID();
 const cookie=randomBytes(32).toString('base64url'),csrfKey=randomBytes(32);
 const bearer=issueAdminSessionToken(randomBytes(32)).token;
 const now=Date.now();
 let active=true,executions=0;
 const resolveSession=async(key:string)=>{
  if(!active||key!==cookie)return null;
  return {sessionId,adminBearer:bearer};
 };
 const issued=await issueAppealBffCsrfForSession({
  sessionCookie:cookie,appealId,action:'decision',method:'POST',
  requestOrigin:origin,fetchSite:'same-origin',expectedOrigin:origin,csrfKey,now,
 },{resolveSession});
 assert.equal(issued.headers['Cache-Control'],'no-store');
 assert.equal(JSON.stringify(issued).includes(bearer),false);
 assert.equal(JSON.stringify(issued).includes(sessionId),false);
 const request={action:'decision' as const,appealId,body:{outcome:'uphold'},
  sessionCookie:cookie,csrfToken:issued.token,csrfKey,method:'POST',
  requestOrigin:origin,expectedOrigin:origin,fetchSite:'same-origin',
  contentType:'application/json',now};
 const claimCsrfProof=createAppealBffRedisCsrfClaim({set:redisSet},()=>now);
 const deps={resolveSession,claimCsrfProof,execute:async(action:string,proof:string,id:string)=>{
  assert.equal(action,'decision');assert.equal(proof,bearer);assert.equal(id,appealId);
  executions++;return {accepted:true};
 }};
 const outcomes=await Promise.allSettled(Array.from({length:12},()=>executeAppealBffMutation(request,deps)));
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(x=>x.status==='rejected').length,11);
 assert.equal(executions,1,'real Redis allows exactly one privileged execution');
 await assert.rejects(executeAppealBffMutation(request,deps),UnauthorizedException);
 active=false;
 const fresh=await issueAppealBffCsrfForSession({
  sessionCookie:cookie,appealId,action:'decision',method:'POST',
  requestOrigin:origin,fetchSite:'same-origin',expectedOrigin:origin,csrfKey,now,
 },{resolveSession:async()=>({sessionId})});
 await assert.rejects(executeAppealBffMutation({...request,csrfToken:fresh.token},deps),
  UnauthorizedException);
 assert.equal(executions,1,'revoked session prevents fresh signed proof execution');
});
