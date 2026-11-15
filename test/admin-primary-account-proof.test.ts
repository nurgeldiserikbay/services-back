import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {issueSessionToken,hashSessionToken} from '../src/modules/identity/session-proof.js';
import {resolveRecentAdminPrimaryAccountProof} from '../src/modules/admin/admin-primary-account-proof.js';

const pepper=randomBytes(32);
const token=issueSessionToken(pepper).token;
const staffId=randomUUID();

test('admin primary proof is derived from fresh DB account session, never request fields',async()=>{
 const now=1_800_000_000_000;
 const authenticatedAt=new Date(now-1000);
 let queries=0;
 const db={query:async(sql:string,params:unknown[])=>{
  queries++;
  assert.match(sql,/JOIN platform_admin_staff staff ON staff.user_id=usr.id/);
  assert.match(sql,/session.revoked_at IS NULL/);
  assert.match(sql,/session.created_at>=to_timestamp/);
  assert.match(sql,/staff.disabled_at IS NULL/);
  assert.match(sql,/FOR SHARE OF session,usr,staff/);
  assert.deepEqual(params,[hashSessionToken(token,pepper),now]);
  return {rows:[{staff_id:staffId,authenticated_at:authenticatedAt}]};
 }};
 assert.deepEqual(await resolveRecentAdminPrimaryAccountProof(db as never,token,pepper,now),
  {staffId,authenticatedAt:authenticatedAt.getTime()});
 assert.equal(queries,1);
});

test('admin primary proof fails closed for malformed, expired and ambiguous evidence',async()=>{
 const now=1_800_000_000_000;
 let queries=0;
 const db={query:async()=>{queries++;return {rows:[]};}};
 for(const proof of [undefined,'invalid','Bearer '+token,{staffId,authenticatedAt:now}]){
  assert.equal(await resolveRecentAdminPrimaryAccountProof(db as never,proof,pepper,now),null);
 }
 assert.equal(queries,0);
 for(const rows of [
  [],
  [{staff_id:staffId,authenticated_at:new Date(now-300001)}],
  [{staff_id:staffId,authenticated_at:new Date(now+1)}],
  [{staff_id:staffId,authenticated_at:new Date('invalid')}],
  [{staff_id:'invalid',authenticated_at:new Date(now)}],
  [{staff_id:staffId,authenticated_at:new Date(now)},
   {staff_id:randomUUID(),authenticated_at:new Date(now)}],
 ]){
  const result=await resolveRecentAdminPrimaryAccountProof(
   {query:async()=>({rows})} as never,token,pepper,now);
  assert.equal(result,null);
 }
});
