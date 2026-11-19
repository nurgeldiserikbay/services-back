import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {createAppealBffRedisCsrfClaim} from '../src/modules/admin/admin-professional-appeal-bff-redis-claim.js';

test('Redis CSRF claim is atomic across workers and expires only after proof lifetime',async()=>{
 const session=randomUUID(),digest=createHash('sha256').update('proof').digest('hex');
 const current=1_800_000_000_000;
 const entries=new Map<string,{expires:number;value:string}>();
 const redis={set:async(key:string,value:string,options:{NX:true;PX:number})=>{
  assert.equal(options.NX,true);
  assert.match(key,/^services:appeal-bff:csrf:v1:[a-f0-9]{64}$/);
  assert.ok(!key.includes(session));
  const existing=entries.get(key);
  if(existing&&existing.expires>current)return null;
  entries.set(key,{expires:current+options.PX,value});
  return 'OK';
 }};
 const workers=Array.from({length:12},()=>createAppealBffRedisCsrfClaim(redis,()=>current));
 const outcomes=await Promise.all(workers.map(claim=>claim(session,digest,current+600_000)));
 assert.equal(outcomes.filter(Boolean).length,1);
 assert.equal(entries.size,1);
 assert.equal([...entries.values()][0].expires,current+600_001);
 assert.equal(await workers[0](session,digest,current+600_000),false);
 assert.equal(await workers[0](randomUUID(),digest,current+600_000),true);
 assert.equal(await workers[0](session,createHash('sha256').update('other').digest('hex'),current+600_000),true);
});

test('Redis CSRF adapter refuses malformed claims without calling Redis',async()=>{
 let calls=0;const now=1_800_000_000_000;
 const claim=createAppealBffRedisCsrfClaim({set:async()=>{calls++;return 'OK';}},()=>now);
 const id=randomUUID(),digest='a'.repeat(64);
 for(const [session,hash,expiry] of [
  ['invalid',digest,now+1],[id,'bad',now+1],
  [id,digest,now],[id,digest,now-1],
  [id,digest,now+600_001],[id,digest,Number.NaN],
 ] as const)assert.equal(await claim(session,hash,expiry),false);
 assert.equal(calls,0);
});

test('Redis outage or unexpected response never claims a proof',async()=>{
 const id=randomUUID(),hash='b'.repeat(64),now=1_800_000_000_000;
 const disconnected=createAppealBffRedisCsrfClaim({
  set:async()=>{throw new Error('redis unavailable');},
 },()=>now);
 await assert.rejects(disconnected(id,hash,now+1000),/redis unavailable/);
 const inconsistent=createAppealBffRedisCsrfClaim({
  set:async()=> 'UNEXPECTED',
 },()=>now);
 await assert.rejects(inconsistent(id,hash,now+1000),/Unexpected atomic/);
});
