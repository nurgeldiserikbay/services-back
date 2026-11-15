import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {revokeAdminTotpFactor} from '../src/modules/admin/admin-totp-factor-revoke.js';

const actor=randomUUID(),target=randomUUID();
const pepper=randomBytes(32);
const {token,tokenHash}=issueAdminSessionToken(pepper);
function fixture(mode:'ok'|'no-actor'|'no-factor'|'audit-fails'|'commit-fails'|'revoke-unconfirmed'){
 const events:string[]=[];
 const client={
  query:async(sql:string,params?:unknown[])=>{
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)){
    events.push(sql);
    if(sql==='COMMIT'&&mode==='commit-fails')throw Error('commit failed');
    return {rows:[]};
   }
   if(sql.startsWith('SET LOCAL ')){
    events.push(sql.includes('lock_timeout')?'lock-timeout':'statement-timeout');
    return {rows:[]};
   }
   if(sql.includes('FOR SHARE OF staff')){
    events.push('authorize-actor');
    assert.equal(params?.[0],tokenHash);
    assert.equal(typeof params?.[1],'number');
    assert.ok(Number.isSafeInteger(params?.[1] as number));
    assert.match(sql,/session.token_hash=\$1/);
    assert.match(sql,/session\.created_at<=to_timestamp\(\$2::double precision\/1000\)/);
      assert.match(sql,/staff.role='owner'/);
    assert.match(sql,/actor_factor.activated_at IS NOT NULL/);
    assert.match(sql,/actor_factor\.activated_at<=session\.mfa_verified_at/);
    assert.match(sql,/actor_factor.disabled_at IS NULL/);
    assert.match(sql,/session.mfa_verified_at<=to_timestamp/);
    assert.match(sql,/session.mfa_verified_at>=to_timestamp\(\(\$2::double precision-900000\)\/1000\)/);
    assert.match(sql,/session.expires_at>session.mfa_verified_at/);
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
    events.push('revoke-sessions');
    return {rows:[],rowCount:mode==='revoke-unconfirmed'?null:1};
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
  'BEGIN','lock-timeout','statement-timeout','target-lock','authorize-actor','disable-factor','revoke-sessions',
  'audit','COMMIT','release',
 ]);
});
test('unknown actor cannot revoke factor',async()=>{
 const f=fixture('no-actor');
 assert.equal(await revokeAdminTotpFactor(f.pool,token,target,pepper),false);
 assert.deepEqual(f.events,['BEGIN','lock-timeout','statement-timeout','target-lock','authorize-actor','ROLLBACK','release']);
});
test('missing factor does not revoke sessions',async()=>{
 const f=fixture('no-factor');
 assert.equal(await revokeAdminTotpFactor(f.pool,token,target,pepper),false);
 assert.deepEqual(f.events,[
  'BEGIN','lock-timeout','statement-timeout','target-lock','authorize-actor','disable-factor','ROLLBACK','release',
 ]);
});
test('audit failure rolls back factor and session revocation',async()=>{
 const f=fixture('audit-fails');
 await assert.rejects(revokeAdminTotpFactor(f.pool,token,target,pepper),
  /admin_totp_revocation_audit_unavailable/);
 assert.deepEqual(f.events,[
  'BEGIN','lock-timeout','statement-timeout','target-lock','authorize-actor','disable-factor','revoke-sessions',
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
 assert.equal(await revokeAdminTotpFactor(pool,token,target,pepper,8640000000000001),false);
 assert.equal(await revokeAdminTotpFactor(pool,token,target,pepper,Number.MAX_SAFE_INTEGER),false);
 assert.equal(calls,0);
});

test('commit failure does not report successful revocation',async()=>{
 const f=fixture('commit-fails');
 await assert.rejects(revokeAdminTotpFactor(f.pool,token,target,pepper),/commit failed/);
 assert.deepEqual(f.events,[
  'BEGIN','lock-timeout','statement-timeout','target-lock','authorize-actor','disable-factor','revoke-sessions',
  'audit','COMMIT','ROLLBACK','release',
 ]);
});

test('incident-response revocation discards connection when rollback fails',async()=>{
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'){events.push('BEGIN');return {rows:[]};}
   if(sql.startsWith('SET LOCAL ')){
    events.push(sql.includes('lock_timeout')?'lock-timeout':'statement-timeout');
    return {rows:[]};
   }
   if(sql==='ROLLBACK'){events.push('ROLLBACK');throw Error('rollback failed');}
   if(sql.includes('pg_advisory_xact_lock')){
    events.push('lock');throw Error('lock failed');
   }
   throw Error('unexpected SQL');
  },
  release:(broken?:boolean)=>events.push('release:'+String(broken)),
 };
 await assert.rejects(revokeAdminTotpFactor(
  {connect:async()=>client} as never,token,target,pepper,
 ),/lock failed/);
 assert.deepEqual(events,['BEGIN','lock-timeout','statement-timeout','lock','ROLLBACK','release:true']);
});
test('incident-response revocation retains connection after successful rollback',async()=>{
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'){events.push('BEGIN');return {rows:[]};}
   if(sql.startsWith('SET LOCAL ')){
    events.push(sql.includes('lock_timeout')?'lock-timeout':'statement-timeout');
    return {rows:[]};
   }
   if(sql==='ROLLBACK'){events.push('ROLLBACK');return {rows:[]};}
   if(sql.includes('pg_advisory_xact_lock')){
    events.push('lock');throw Error('lock failed');
   }
   throw Error('unexpected SQL');
  },
  release:(broken?:boolean)=>events.push('release:'+String(broken)),
 };
 await assert.rejects(revokeAdminTotpFactor(
  {connect:async()=>client} as never,token,target,pepper,
 ),/lock failed/);
 assert.deepEqual(events,['BEGIN','lock-timeout','statement-timeout','lock','ROLLBACK','release:false']);
});

test('unconfirmed session revocation aborts factor change before audit',async()=>{
 const f=fixture('revoke-unconfirmed');
 await assert.rejects(
  revokeAdminTotpFactor(f.pool,token,target,pepper),
  /admin_totp_session_revocation_unavailable/,
 );
 assert.deepEqual(f.events,[
  'BEGIN','lock-timeout','statement-timeout','target-lock','authorize-actor','disable-factor','revoke-sessions',
  'ROLLBACK','release',
 ]);
});

test('incident-response rejects invalid pool before attempting SQL',async()=>{
 for(const pool of [null,undefined,{}, {connect:null}, {connect:'invalid'}]){
  assert.equal(await revokeAdminTotpFactor(pool as never,token,target,pepper),false);
 }
});

test('incident-response discards malformed checked-out clients before BEGIN',async()=>{
 for(const client of [
  {query:null,release:(_broken?:boolean)=>{}},
  {query:async()=>{},release:null},
 ]){
  const releases:unknown[]=[];
  const acquired={
   ...client,
   release:client.release===null?null:(broken?:boolean)=>{releases.push(broken);},
  };
  await assert.rejects(
   revokeAdminTotpFactor(
    {connect:async()=>acquired} as never,token,target,pepper,
   ),
   /admin_totp_revocation_connection_unavailable/,
  );
  assert.deepEqual(releases,client.release===null?[]:[true]);
 }
});

test('failed BEGIN discards uncertain incident-response connection',async()=>{
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   events.push(sql);
   if(sql==='BEGIN')throw Error('begin failed');
   throw Error('unexpected SQL');
  },
  release:(broken?:boolean)=>events.push('release:'+String(broken)),
 };
 await assert.rejects(revokeAdminTotpFactor(
  {connect:async()=>client} as never,token,target,pepper,
 ),/begin failed/);
 assert.deepEqual(events,['BEGIN','release:true']);
});

test('failed COMMIT discards incident-response connection after rollback',async()=>{
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){
    events.push(sql);
    if(sql==='COMMIT')throw Error('commit failed');
    return {rows:[]};
   }
   if(sql.startsWith('SET LOCAL ')){
    events.push(sql.includes('lock_timeout')?'lock-timeout':'statement-timeout');
    return {rows:[]};
   }
   if(sql.includes('pg_advisory_xact_lock')){
    events.push('lock');return {rows:[{}]};
   }
   if(sql.includes('FOR SHARE OF staff')){
    events.push('actor');return {rows:[{id:actor}]};
   }
   if(sql.includes('UPDATE platform_admin_totp_factors')){
    events.push('factor');return {rows:[{staff_id:target}]};
   }
   if(sql.includes('UPDATE platform_admin_sessions')){
    events.push('sessions');return {rows:[],rowCount:1};
   }
   if(sql.includes('INSERT INTO platform_admin_security_events')){
    events.push('audit');return {rows:[{id:randomUUID()}]};
   }
   throw Error('unexpected SQL');
  },
  release:(broken?:boolean)=>events.push('release:'+String(broken)),
 };
 await assert.rejects(revokeAdminTotpFactor(
  {connect:async()=>client} as never,token,target,pepper,
 ),/commit failed/);
 assert.deepEqual(events,[
  'BEGIN','lock-timeout','statement-timeout','lock','actor','factor','sessions','audit','COMMIT','ROLLBACK','release:true',
 ]);
});
