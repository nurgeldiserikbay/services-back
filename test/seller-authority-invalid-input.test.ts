import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolveSellerDecisionAuthority} from '../src/modules/requests/seller-authority.js';

// Invalid identity/request IDs must be rejected before any SQL is issued.
test('seller decision authorization fails closed before database access',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;throw new Error('unexpected_sql');}};
 for(const [userId,requestId] of [
   ['invalid',randomUUID()],
   [randomUUID(),'invalid'],
   ['',randomUUID()],
   [randomUUID(),''],
 ]){
   assert.deepEqual(await resolveSellerDecisionAuthority(db as never,userId,requestId),
     {authorized:false});
 }
 assert.equal(queries,0);
});
