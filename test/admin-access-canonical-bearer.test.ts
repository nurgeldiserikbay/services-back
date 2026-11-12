import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PlatformAdminAccessService} from '../src/modules/admin/admin-access.service.js';
import type {DatabasePool} from '../src/platform/database/database.pool.js';

test('admin access denies noncanonical bearer proof before opening a transaction',async()=>{
 let transactions=0;
 const db={
  transaction:async()=>{transactions++;throw new Error('unexpected_database_access');},
 } as unknown as DatabasePool;
 const access=new PlatformAdminAccessService(db);
 const canonical='A'.repeat(43);
 for(const proof of [
  undefined,null,'','Bearer '+canonical.slice(0,-1)+'B',
  'Bearer '+canonical+'=', 'Bearer '+canonical+' ',
  'bearer '+canonical,'Bearer '+canonical+', Bearer '+canonical,
 ]){
  await assert.rejects(access.requireOperation(proof,'moderation.read','platform'),{status:401});
 }
 assert.equal(transactions,0);
});

test('admin access denies valid bearer without configured session secret before database access',async()=>{
 const previous=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 let transactions=0;
 const db={transaction:async()=>{transactions++;throw new Error('unexpected_database_access');}} as unknown as DatabasePool;
 try{
  const access=new PlatformAdminAccessService(db);
  for(const secret of [undefined,'invalid']){
   if(secret===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
   else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=secret;
   await assert.rejects(access.requireOperation('Bearer '+'A'.repeat(43),'moderation.read','platform'),{status:401});
  }
  assert.equal(transactions,0);
 }finally{
  if(previous===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=previous;
 }
});

test('admin access hides unexpected transaction failures but preserves explicit denials',async()=>{
 const previous=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 try{
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=Buffer.alloc(32,7).toString('base64');
  const proof='Bearer '+'A'.repeat(43);
  for(const [failure,expected] of [
   [new Error('private database connection details'),401],
   [Object.assign(new Error('Authentication required'),{status:401}),401],
  ] as const){
   const db={transaction:async()=>{throw failure;}} as unknown as DatabasePool;
   const access=new PlatformAdminAccessService(db);
   await assert.rejects(access.requireOperation(proof,'moderation.read','platform'),error=>
    typeof error==='object'&&error!==null&&'status' in error&&error.status===expected&&
    !String(error.message).includes('private database'));
  }
 }finally{
  if(previous===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=previous;
 }
});
