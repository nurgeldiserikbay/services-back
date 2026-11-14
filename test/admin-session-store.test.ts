import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {authorizeAdminReadFromDatabase} from '../src/modules/admin/admin-session-store.js';

const pepper=Buffer.alloc(32,29);
const {token,tokenHash}=issueAdminSessionToken(pepper);
const now=new Date('2026-11-10T10:00:00.000Z');
const row={
  token_hash:tokenHash,role:'admin',
  user_id:'10000000-0000-4000-8000-000000000001',
  expires_at:new Date('2026-11-10T11:00:00.000Z'),
  revoked_at:null,disabled_at:null,
  mfa_verified_at:new Date('2026-11-10T09:00:00.000Z'),
};
function fakeDb(rows:unknown[],queries:{sql:string;params:unknown[]}[]){
  return {query:async(sql:string,params:unknown[])=>{
    queries.push({sql,params});return {rows};
  }} as unknown as Pool;
}
test('database authorization looks up only hashed bearer and active accounts',async()=>{
  const queries:{sql:string;params:unknown[]}[]=[];
  const principal=await authorizeAdminReadFromDatabase(
    fakeDb([row],queries),token,pepper,now,'audit.read');
  assert.deepEqual(principal,{userId:row.user_id,role:'admin'});
  assert.equal(queries.length,1);
  assert.deepEqual(queries[0].params,[tokenHash,now]);
  assert.doesNotMatch(queries[0].sql,new RegExp(token));
  assert.match(queries[0].sql,/u\.status='ACTIVE'/);
  assert.match(queries[0].sql,/st\.disabled_at IS NULL/);
  assert.match(queries[0].sql,/s\.revoked_at IS NULL/);
});
test('invalid bearer is rejected before database lookup',async()=>{
  const queries:{sql:string;params:unknown[]}[]=[];
  assert.equal(await authorizeAdminReadFromDatabase(
    fakeDb([row],queries),'invalid',pepper,now,'audit.read'),null);
  assert.equal(queries.length,0);
});
test('missing session, disallowed role and disabled staff deny access',async()=>{
  for(const rows of [[],[{...row,role:'operator'}],[{...row,disabled_at:now}]]){
    const result=await authorizeAdminReadFromDatabase(
      fakeDb(rows,[]),token,pepper,now,'audit.read');
    assert.equal(result,null);
  }
});


test('malformed admin session database responses deny access',async()=>{
 for(const response of [
  null,undefined,{}, {rows:null},{rows:{}},{rows:[row,row]},
  {rows:[null]},{rows:[undefined]},
 ]){
  const db={query:async()=>response} as unknown as Pool;
  assert.equal(await authorizeAdminReadFromDatabase(
   db,token,pepper,now,'audit.read',
  ),null);
 }
});

test('admin session database outages do not authorize requests',async()=>{
 const db={query:async()=>{throw new Error('database unavailable');}} as unknown as Pool;
 await assert.rejects(authorizeAdminReadFromDatabase(
  db,token,pepper,now,'audit.read',
 ),/database unavailable/);
});
