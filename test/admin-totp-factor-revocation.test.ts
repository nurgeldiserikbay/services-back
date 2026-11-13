import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {revokeAdminTotpFactorAndSessions} from '../src/modules/admin/admin-totp-factor-revocation.js';

const staffId=randomUUID();
const now=1763000000000;
const pepper=randomBytes(32);
const token=randomBytes(32).toString('base64url');
function fixture(mode:'active'|'already-disabled'|'revoke-fails'|'audit-fails'|'unauthorized'='active'){
 const events:string[]=[];
 const client={
  query:async(sql:string,params?:unknown[])=>{
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)){
    events.push(sql);return {rows:[]};
   }
   if(sql.includes('pg_advisory_xact_lock')){
    assert.deepEqual(params?.[0],staffId);
    events.push('lock');return {rows:[{}]};
   }
   if(sql.includes('FROM platform_admin_sessions session')){
    events.push('authorize');
    assert.equal(params?.[1],now);
    return {rows:mode==='unauthorized'?[]:[{staff_id:staffId}]};
   }
   if(sql.includes('INSERT INTO platform_admin_security_events')){
    events.push('audit');
    assert.deepEqual(params,[staffId,staffId,now]);
    if(mode==='audit-fails')throw Error('audit unavailable');
    return {rows:[],rowCount:1};
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
 assert.equal(await revokeAdminTotpFactorAndSessions(f.pool,staffId,token,pepper,now),true);
 assert.deepEqual(f.events,['BEGIN','lock','authorize','disable','revoke-sessions','audit','COMMIT','release']);
});
test('already disabled factor still revokes remaining sessions',async()=>{
 const f=fixture('already-disabled');
 assert.equal(await revokeAdminTotpFactorAndSessions(f.pool,staffId,token,pepper,now),false);
 assert.deepEqual(f.events,['BEGIN','lock','authorize','disable','revoke-sessions','audit','COMMIT','release']);
});
test('session revocation failure rolls back factor disable',async()=>{
 const f=fixture('revoke-fails');
 await assert.rejects(revokeAdminTotpFactorAndSessions(f.pool,staffId,token,pepper,now),/session revoke failed/);
 assert.deepEqual(f.events,['BEGIN','lock','authorize','disable','revoke-sessions','ROLLBACK','release']);
});
test('malformed identity does not connect to database',async()=>{
 let connected=false;
 const pool={connect:async()=>{connected=true;throw Error('unexpected connect');}} as never;
 assert.equal(await revokeAdminTotpFactorAndSessions(pool,'invalid',token,pepper,now),false);
 assert.equal(connected,false);
});

test('missing security grant or expired actor session rejects revocation',async()=>{
 const f=fixture('unauthorized');
 assert.equal(await revokeAdminTotpFactorAndSessions(f.pool,staffId,token,pepper,now),false);
 assert.deepEqual(f.events,['BEGIN','lock','authorize','ROLLBACK','release']);
});
test('invalid actor bearer is rejected before connecting',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('unexpected');}} as never;
 assert.equal(await revokeAdminTotpFactorAndSessions(pool,staffId,'invalid',pepper,now),false);
 assert.equal(connections,0);
});

test('audit failure rolls back factor and session revocation',async()=>{
 const f=fixture('audit-fails');
 await assert.rejects(revokeAdminTotpFactorAndSessions(
  f.pool,staffId,token,pepper,now,
 ),/audit unavailable/);
 assert.deepEqual(f.events,[
  'BEGIN','lock','authorize','disable','revoke-sessions','audit','ROLLBACK','release',
 ]);
});
