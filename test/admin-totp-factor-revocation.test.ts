import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {revokeAdminTotpFactorAndSessions} from '../src/modules/admin/admin-totp-factor-revocation.js';

const staffId=randomUUID();
const now=1763000000000;
function fixture(mode:'active'|'already-disabled'|'revoke-fails'='active'){
 const events:string[]=[];
 const client={
  query:async(sql:string,params?:unknown[])=>{
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)){
    events.push(sql);return {rows:[]};
   }
   assert.deepEqual(params?.[0],staffId);
   if(sql.includes('pg_advisory_xact_lock')){
    events.push('lock');return {rows:[{}]};
   }
   assert.deepEqual(params,[staffId,now]);
   if(sql.includes('UPDATE platform_admin_totp_factors')){
    events.push('disable');
    return {rows:mode==='already-disabled'?[]:[{staff_id:staffId}]};
   }
   if(sql.includes('UPDATE platform_admin_sessions')){
    events.push('revoke-sessions');
    if(mode==='revoke-fails')throw Error('session revoke failed');
    return {rows:[],rowCount:1};
   }
   throw Error('unexpected query');
  },
  release:()=>events.push('release'),
 };
 return {pool:{connect:async()=>client} as never,events};
}
test('revocation disables factor and all sessions before commit',async()=>{
 const f=fixture();
 assert.equal(await revokeAdminTotpFactorAndSessions(f.pool,staffId,now),true);
 assert.deepEqual(f.events,['BEGIN','lock','disable','revoke-sessions','COMMIT','release']);
});
test('already disabled factor still revokes remaining sessions',async()=>{
 const f=fixture('already-disabled');
 assert.equal(await revokeAdminTotpFactorAndSessions(f.pool,staffId,now),false);
 assert.deepEqual(f.events,['BEGIN','lock','disable','revoke-sessions','COMMIT','release']);
});
test('session revocation failure rolls back factor disable',async()=>{
 const f=fixture('revoke-fails');
 await assert.rejects(revokeAdminTotpFactorAndSessions(f.pool,staffId,now),/session revoke failed/);
 assert.deepEqual(f.events,['BEGIN','lock','disable','revoke-sessions','ROLLBACK','release']);
});
test('malformed identity does not connect to database',async()=>{
 let connected=false;
 const pool={connect:async()=>{connected=true;throw Error('unexpected connect');}} as never;
 assert.equal(await revokeAdminTotpFactorAndSessions(pool,'invalid',now),false);
 assert.equal(connected,false);
});
