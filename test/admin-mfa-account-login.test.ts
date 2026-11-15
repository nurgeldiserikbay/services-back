import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {loginAdminWithRecentAccountSession} from '../src/modules/admin/admin-mfa-account-login.js';

test('trusted admin login rejects malformed primary proof or shared secrets before connecting',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('unexpected database access');}};
 const accountSessionPepper=randomBytes(32);
 const adminSessionPepper=randomBytes(32);
 const token=issueSessionToken(accountSessionPepper).token;
 const resolveTotpKey=async()=>randomBytes(32);
 const deps={pool,accountSessionPepper,adminSessionPepper,resolveTotpKey};
 for(const [bearer,code] of [
  ['invalid','123456'],['Bearer '+token,'123456'],
  [null,'123456'],
 ]){
  assert.equal(await loginAdminWithRecentAccountSession(
   deps as never,bearer,code),null);
 }
 assert.equal(await loginAdminWithRecentAccountSession(
  {...deps,adminSessionPepper:accountSessionPepper} as never,token,'123456'),null);
 assert.equal(await loginAdminWithRecentAccountSession(
  {...deps,resolveTotpKey:null} as never,token,'123456'),null);
 assert.equal(connections,0);
});

test('malformed TOTP is forwarded to durable MFA attempt path, not silently discarded',async()=>{
 const accountSessionPepper=randomBytes(32);
 const adminSessionPepper=randomBytes(32);
 const token=issueSessionToken(accountSessionPepper).token;
 const queries:string[]=[];
 const releases:unknown[]=[];
 const client={
  query:async(sql:string)=>{
   queries.push(sql);
   if(sql==='BEGIN'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL '))return {rows:[]};
   if(sql.includes('FROM sessions session'))return {rows:[]};
   throw Error('unexpected SQL');
  },
  release:(error?:unknown)=>releases.push(error),
 };
 let connections=0;
 const deps={
  pool:{connect:async()=>{connections++;return client;}},
  accountSessionPepper,adminSessionPepper,
  resolveTotpKey:async()=>randomBytes(32),
 };
 assert.equal(await loginAdminWithRecentAccountSession(
  deps as never,token,'12x'),null);
 assert.equal(connections,1);
 assert.ok(queries.some(sql=>sql.includes('FROM sessions session')));
 assert.ok(queries.includes('ROLLBACK'));
 assert.deepEqual(releases,[undefined]);
});
