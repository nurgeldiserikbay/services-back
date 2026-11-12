import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolveSellerDecisionAuthority} from '../src/modules/requests/seller-authority.js';

test('seller authority rejects invalid identities and request IDs before querying PostgreSQL',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;throw new Error('database must not be reached');}};
 const valid=randomUUID();
 for(const [userId,requestId] of [
  ['',valid],[valid,''],['not-a-uuid',valid],[valid,'not-a-uuid'],
  ['00000000-0000-0000-0000-000000000000',valid],
  [valid,'00000000-0000-0000-0000-000000000000'],
  [valid,valid+' OR 1=1'],[' '+valid,valid],
  [valid,valid+' '],[null,valid],[valid,undefined],
  [42,valid],[valid,{}],
 ]){
  assert.deepEqual(await resolveSellerDecisionAuthority(db as never,
    userId as unknown as string,requestId as unknown as string),{authorized:false});
 }
 assert.equal(calls,0);
});

test('seller authority rejects missing and inconsistent seller ownership',async()=>{
 const userId=randomUUID(),requestId=randomUUID();
 const professionalId=randomUUID(),organizationId=randomUUID();
 for(const row of [
  undefined,
  {professional_id:null,organization_id:null},
  {professional_id:professionalId,organization_id:organizationId},
  {professional_id:'invalid',organization_id:null},
  {professional_id:null,organization_id:'invalid'},
 ]){
  let calls=0;
  const db={query:async()=>{calls++;return {rows:row?[row]:[]};}};
  assert.deepEqual(await resolveSellerDecisionAuthority(db as never,userId,requestId),
    {authorized:false});
  assert.equal(calls,1);
 }
});
