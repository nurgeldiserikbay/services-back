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
