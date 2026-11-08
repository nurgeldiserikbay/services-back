import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PlatformModerationReadService} from '../src/modules/admin/admin-moderation-read.service.js';
import type {DatabasePool} from '../src/platform/database/database.pool.js';

const validToken='A'.repeat(43);
const originalFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
const originalKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;

function fakeDatabase(){
 let transactions=0;
 const db={transaction:async()=>{transactions++;throw new Error('unexpected_database_access');}} as unknown as DatabasePool;
 return {db,transactions:()=>transactions};
}

test('moderation read is disabled by default and never touches the database',async()=>{
 try{
  delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  const fake=fakeDatabase();
  const service=new PlatformModerationReadService(fake.db);
  await assert.rejects(service.list('Bearer '+validToken),{status:401});
  assert.equal(fake.transactions(),0);
 }finally{
  if(originalFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=originalFlag;
 }
});

test('invalid bearer fails before database access even with feature flag enabled',async()=>{
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY='A'.repeat(43);
  const fake=fakeDatabase();
  const service=new PlatformModerationReadService(fake.db);
  for(const bearer of [undefined,null,'','Bearer ','bearer '+validToken,'Bearer '+validToken+'x','Bearer '+validToken+' ','Basic '+validToken]){
   await assert.rejects(service.list(bearer),{status:401});
  }
  assert.equal(fake.transactions(),0);
 }finally{
  if(originalFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=originalFlag;
  if(originalKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=originalKey;
 }
});
