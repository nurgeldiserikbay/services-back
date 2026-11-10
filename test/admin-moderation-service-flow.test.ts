import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {DatabasePool} from '../src/platform/database/database.pool.js';
import {PlatformModerationReadService} from '../src/modules/admin/admin-moderation-read.service.js';

const scope='platform:123e4567-e89b-42d3-a456-426614174001';
const userId='123e4567-e89b-42d3-a456-426614174000';
const caseId='123e4567-e89b-42d3-a456-426614174002';
const token='A'.repeat(43);
const originalFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
const originalKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
function dbWithRows(grants:unknown[],cases:unknown[]){
 const calls:{sql:string;params:unknown[]}[]=[];
 const db={transaction:async(work:(client:unknown)=>Promise<unknown>)=>
  work({query:async(sql:string,params:unknown[])=>{
   calls.push({sql,params});
   return {rows:sql.includes('FROM platform_admin_sessions')?grants:cases};
  }})} as unknown as DatabasePool;
 return {db,calls};
}
function grant(overrides:Record<string,unknown>={}){
 const now=Date.now();
 return {user_id:userId,role:'operator',expires_at:new Date(now+60_000),
  mfa_verified_at:new Date(now-1000),scope,...overrides};
}
function moderationCase(overrides:Record<string,unknown>={}){
 return {id:caseId,resource_scope:scope,subject_kind:'professional',
  state:'triage',created_at:new Date('2026-11-08T00:00:00.000Z'),...overrides};
}
async function withFeatureFlag(work:()=>Promise<void>){
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=Buffer.alloc(32,7).toString('base64');
  await work();
 }finally{
  if(originalFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=originalFlag;
  if(originalKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=originalKey;
 }
}
test('moderation service queries only authorized scopes and returns redacted rows',async()=>{
 await withFeatureFlag(async()=>{
  const {db,calls}=dbWithRows([grant()],[moderationCase()]);
  const result=await new PlatformModerationReadService(db).list('Bearer '+token);
  assert.deepEqual(result.items,[{id:caseId,subjectKind:'professional',
   state:'triage',createdAt:'2026-11-08T00:00:00.000Z'}]);
  assert.equal(calls.length,2);
  assert.deepEqual(calls[1].params,[[scope]]);
  assert.match(calls[1].sql,/LIMIT 50/);
 });
});
test('moderation service does not query cases for missing or stale MFA',async()=>{
 await withFeatureFlag(async()=>{
  const scenarios=[
   {grants:[],unauthorized:true},
   {grants:[grant({mfa_verified_at:new Date(Date.now()-20*60_000)})],unauthorized:true},
   {grants:[grant({role:'invalid'})],unauthorized:true},
   {grants:[grant({scope:null})],unauthorized:false},
  ];
  for(const {grants,unauthorized} of scenarios){
   const {db,calls}=dbWithRows(grants,[moderationCase()]);
   const service=new PlatformModerationReadService(db);
   if(unauthorized)
    await assert.rejects(service.list('Bearer '+token),{status:401});
   else assert.deepEqual(await service.list('Bearer '+token),{items:[]});
   assert.equal(calls.length,1);
  }
 });
});
test('moderation service refuses an out-of-scope row returned by database',async()=>{
 await withFeatureFlag(async()=>{
  const {db}=dbWithRows([grant()],[moderationCase({resource_scope:'other'})]);
  await assert.rejects(new PlatformModerationReadService(db).list('Bearer '+token),{status:401});
 });
});

test('moderation service fails closed on malformed database-driver page replies',async()=>{
 await withFeatureFlag(async()=>{
  for(const malformed of [null,undefined,{}, {rows:null}, {rows:'invalid'}]){
   let calls=0;
   const db={transaction:async(work:(client:unknown)=>Promise<unknown>)=>
    work({query:async(sql:string)=>{
     calls++;
     return sql.includes('FROM platform_admin_sessions')?
      {rows:[grant()]}:malformed;
    }})} as unknown as DatabasePool;
   await assert.rejects(
    new PlatformModerationReadService(db).list('Bearer '+token),
    {status:401},
   );
   assert.equal(calls,2,'authorization query precedes fail-closed page validation');
  }
 });
});
