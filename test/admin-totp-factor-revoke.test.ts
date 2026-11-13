import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {revokeAdminTotpFactor} from '../src/modules/admin/admin-totp-factor-revoke.js';

const actor=randomUUID(),target=randomUUID();
const pepper=randomBytes(32);
const {token,tokenHash}=issueAdminSessionToken(pepper);
function fixture(mode:'ok'|'no-actor'|'no-factor'|'audit-fails'|'commit-fails'){
 const events:string[]=[];
 const client={
  query:async(sql:string,params?:unknown[])=>{
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)){
    events.push(sql);
    if(sql==='COMMIT'&&mode==='commit-fails')throw Error('commit failed');
    return {rows:[]};
   }
   if(sql.includes('FOR SHARE OF staff')){
    events.push('authorize-actor');
    assert.equal(params?.[0],tokenHash);
    assert.equal(typeof params?.[1],'number');
    assert.ok(Number.isSafeInteger(params?.[1] as number));
    assert.match(sql,/session.token_hash=\$1/);
    assert.match(sql,/staff.role='owner'/);
    assert.match(sql,/actor_factor.activated_at IS NOT NULL/);
    assert.match(sql,/actor_factor.disabled_at IS NULL/);
    assert.match(sql,/session.mfa_verified_at<=to_timestamp/);
    assert.match(sql,/grants.scope='admin.security.revoke'/);
    assert.match(sql,/session.revoked_at IS NULL/);
    assert.match(sql,/session.expires_at>/);
    return {rows:mode==='no-actor'?[]:[{id:actor}]};
   }
   if(sql.includes('pg_advisory_xact_lock')){
    events.push('target-lock');
    assert.deepEqual(params,[target]);
    return {rows:[{}]};
   }
   if(sql.includes('UPDATE platform_admin_totp_factors')){
    events.push('disable-factor');
    assert.equal(params?.[0],target);
    return {rows:mode==='no-factor'?[]:[{staff_id:target}]};
   }
   if(sql.includes('UPDATE platform_admin_sessions')){
    events.push('revoke-sessions');return {rows:[]};
   }
   if(sql.includes('INSERT INTO platform_admin_security_events')){
    events.push('audit');
    assert.deepEqual(params,[actor,target]);
    return {rows:mode==='audit-fails'?[]:[{id:randomUUID()}]};
   }
   throw Error('unexpected SQL');
  },
  release:()=>events.push('release'),
 };
 return {pool:{connect:async()=>client} as never,events};
}

test('revocation disables factor, revokes sessions and audits before commit',async()=>{
 const f=fixture('ok');
 assert.equal(await revokeAdminTotpFactor(f.pool,token,target,pepper),true);
 assert.deepEqual(f.events,[
  'BEGIN','target-lock','authorize-actor','disable-factor','revoke-sessions',
  'audit','COMMIT','release',
 ]);
});
test('unknown actor cannot revoke factor',async()=>{
 const f=fixture('no-actor');
 assert.equal(await revokeAdminTotpFactor(f.pool,token,target,pepper),false);
 assert.deepEqual(f.events,['BEGIN','target-lock','authorize-actor','ROLLBACK','release']);
});
test('missing factor does not revoke sessions',async()=>{
 const f=fixture('no-factor');
 assert.equal(await revokeAdminTotpFactor(f.pool,token,target,pepper),false);
 assert.deepEqual(f.events,[
  'BEGIN','target-lock','authorize-actor','disable-factor','ROLLBACK','release',
 ]);
});
test('audit failure rolls back factor and session revocation',async()=>{
 const f=fixture('audit-fails');
 await assert.rejects(revokeAdminTotpFactor(f.pool,token,target,pepper),
  /admin_totp_revocation_audit_unavailable/);
 assert.deepEqual(f.events,[
  'BEGIN','target-lock','authorize-actor','disable-factor','revoke-sessions',
  'audit','ROLLBACK','release',
 ]);
});
test('invalid identities fail before connecting to database',async()=>{
 let calls=0;
 const pool={connect:async()=>{calls++;throw Error('unexpected');}} as never;
 assert.equal(await revokeAdminTotpFactor(pool,'invalid',target,pepper),false);
 assert.equal(await revokeAdminTotpFactor(pool,token,'invalid',pepper),false);
 assert.equal(await revokeAdminTotpFactor(pool,token,target,Buffer.alloc(4)),false);
 assert.equal(await revokeAdminTotpFactor(pool,token,target,pepper,NaN),false);
 assert.equal(await revokeAdminTotpFactor(pool,token,target,pepper,-1),false);
 assert.equal(calls,0);
});

test('commit failure does not report successful revocation',async()=>{
 const f=fixture('commit-fails');
 await assert.rejects(revokeAdminTotpFactor(f.pool,token,target,pepper),/commit failed/);
 assert.deepEqual(f.events,[
  'BEGIN','target-lock','authorize-actor','disable-factor','revoke-sessions',
  'audit','COMMIT','ROLLBACK','release',
 ]);
});
