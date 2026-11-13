import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {revokeAdminTotpFactor} from '../src/modules/admin/admin-totp-factor-revoke.js';

const actor=randomUUID(),target=randomUUID();
function fixture(mode:'ok'|'no-actor'|'no-factor'|'audit-fails'){
 const events:string[]=[];
 const client={
  query:async(sql:string,params?:unknown[])=>{
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)){
    events.push(sql);return {rows:[]};
   }
   if(sql.includes('FOR SHARE OF staff')){
    events.push('authorize-actor');
    assert.deepEqual(params,[actor]);
    return {rows:mode==='no-actor'?[]:[{id:actor}]};
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
 assert.equal(await revokeAdminTotpFactor(f.pool,actor,target),true);
 assert.deepEqual(f.events,[
  'BEGIN','authorize-actor','disable-factor','revoke-sessions',
  'audit','COMMIT','release',
 ]);
});
test('unknown actor cannot revoke factor',async()=>{
 const f=fixture('no-actor');
 assert.equal(await revokeAdminTotpFactor(f.pool,actor,target),false);
 assert.deepEqual(f.events,['BEGIN','authorize-actor','ROLLBACK','release']);
});
test('missing factor does not revoke sessions',async()=>{
 const f=fixture('no-factor');
 assert.equal(await revokeAdminTotpFactor(f.pool,actor,target),false);
 assert.deepEqual(f.events,[
  'BEGIN','authorize-actor','disable-factor','ROLLBACK','release',
 ]);
});
test('audit failure rolls back factor and session revocation',async()=>{
 const f=fixture('audit-fails');
 await assert.rejects(revokeAdminTotpFactor(f.pool,actor,target),
  /admin_totp_revocation_audit_unavailable/);
 assert.deepEqual(f.events,[
  'BEGIN','authorize-actor','disable-factor','revoke-sessions',
  'audit','ROLLBACK','release',
 ]);
});
test('invalid identities fail before connecting to database',async()=>{
 let calls=0;
 const pool={connect:async()=>{calls++;throw Error('unexpected');}} as never;
 assert.equal(await revokeAdminTotpFactor(pool,'invalid',target),false);
 assert.equal(await revokeAdminTotpFactor(pool,actor,'invalid'),false);
 assert.equal(calls,0);
});
