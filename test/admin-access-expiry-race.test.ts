import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PlatformAdminAccessService} from '../src/modules/admin/admin-access.service.js';
import type {DatabasePool} from '../src/platform/database/database.pool.js';

const USER='11111111-1111-4111-8111-111111111111';
const SCOPE='organization:22222222-2222-4222-8222-222222222222';
const BASE=Date.UTC(2026,0,1);

test('admin access rejects a session expiring during the database lookup',async()=>{
 const originalNow=Date.now;
 const previousKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 let reads=0;
 try{
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=Buffer.alloc(32,7).toString('base64');
  Date.now=()=>BASE+(reads===0?0:2000);
  const db={
   transaction:async(work:(client:unknown)=>Promise<unknown>)=>work({
    query:async()=>{
     reads++;
     return {rows:[{
      user_id:USER,role:'admin',expires_at:new Date(BASE+1000),
      mfa_verified_at:new Date(BASE-1000),scope:SCOPE,
     }]};
    },
   }),
  } as unknown as DatabasePool;
  const service=new PlatformAdminAccessService(db);
  await assert.rejects(
   service.requireOperation('Bearer '+'A'.repeat(43),'moderation.read',SCOPE),
   {status:401},
  );
  assert.equal(reads,1);
 }finally{
  Date.now=originalNow;
  if(previousKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=previousKey;
 }
});

test('admin access rejects MFA expiring during the database lookup',async()=>{
 const originalNow=Date.now;
 const previousKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 let reads=0;
 try{
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=Buffer.alloc(32,7).toString('base64');
  Date.now=()=>BASE+(reads===0?0:2000);
  const db={
   transaction:async(work:(client:unknown)=>Promise<unknown>)=>work({
    query:async()=>{
     reads++;
     return {rows:[{
      user_id:USER,role:'admin',expires_at:new Date(BASE+60000),
      mfa_verified_at:new Date(BASE-15*60*1000+1000),scope:SCOPE,
     }]};
    },
   }),
  } as unknown as DatabasePool;
  const service=new PlatformAdminAccessService(db);
  await assert.rejects(
   service.requireOperation('Bearer '+'A'.repeat(43),'moderation.read',SCOPE),
   {status:401},
  );
  assert.equal(reads,1);
 }finally{
  Date.now=originalNow;
  if(previousKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=previousKey;
 }
});
