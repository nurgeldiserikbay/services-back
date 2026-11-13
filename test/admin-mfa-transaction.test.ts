import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {issueAdminSessionInTransaction} from '../src/modules/admin/admin-mfa-transaction.js';

const staffId=randomUUID();
const now=Date.now();
const primary={staffId,authenticatedAt:now-1000};
const secret=randomBytes(32);
const pepper=randomBytes(32);

test('legacy raw-secret MFA path cannot issue a bearer even with valid-looking inputs',async()=>{
 let connections=0;
 const pool={connect:async()=>{
  connections++;
  throw Error('legacy path must not access PostgreSQL');
 }} as never;
 for(const code of ['123456','000000',null,'invalid']){
  assert.equal(await issueAdminSessionInTransaction(
   pool,primary,secret,code,pepper,now,
  ),null);
 }
 assert.equal(connections,0);
});

test('legacy MFA path denies arbitrary caller-controlled seeds and assertions',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('unexpected');}} as never;
 for(const assertion of [primary,{staffId,authenticatedAt:now},
  {staffId:randomUUID(),authenticatedAt:now},
  {staffId:'invalid',authenticatedAt:now}]){
  for(const suppliedSeed of [secret,randomBytes(32)]){
   assert.equal(await issueAdminSessionInTransaction(
    pool,assertion,suppliedSeed,'123456',pepper,now,
   ),null);
  }
 }
 assert.equal(connections,0);
});
