import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {sealAdminTotpSecret} from '../src/modules/admin/admin-totp-secret.js';
import {activateProvisionedAdminTotp} from '../src/modules/admin/admin-totp-activation.js';

const staffId=randomUUID();
const secret=randomBytes(32);
const key=randomBytes(32);
const now=123456*30000;
const counter=now/30000;
const input=Buffer.alloc(8);
input.writeBigUInt64BE(BigInt(counter));
const digest=createHmac('sha1',secret).update(input).digest();
const offset=digest[digest.length-1]!&15;
const code=String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
const envelope=sealAdminTotpSecret(secret,staffId,key);

function fixture(mode:'ok'|'missing'|'replayed'|'commit-fails'|'locked'|'audit-fails'){
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){
    events.push(sql);
    if(sql==='COMMIT'&&mode==='commit-fails')throw Error('commit failed');
    return {rows:[]};
   }
   if(sql.includes('INSERT INTO platform_admin_security_events')){
    events.push('audit');return {rows:mode==='audit-fails'?[]:[{id:randomUUID()}]};
   }
   if(sql.includes('pg_advisory_xact_lock')){
    events.push('staff-lock');return {rows:[{}]};
   }
   if(sql.includes('DELETE FROM platform_admin_mfa_attempts')){
    events.push('clear-failures');return {rows:[]};
   }
   if(sql.includes('FROM platform_admin_mfa_attempts')){
    events.push('lockout');
    return {rows:mode==='locked'?[{
     locked_until:new Date(now+60000),
     failed_attempts:5,
     window_started_at:new Date(now-1000),
    }]:[]};
   }
   if(sql.includes('INSERT INTO platform_admin_mfa_attempts')){
    events.push('failure');return {rows:[{failed_attempts:1,locked_until:null}]};
   }
   if(sql.includes('FOR UPDATE OF factor')){
    assert.match(sql,/platform_admin_grants/);
    events.push('factor-lock');
    return {rows:mode==='missing'?[]:[{encrypted_secret:envelope,key_version:'key-1'}]};
   }
   if(sql.includes('platform_admin_totp_replay')){
    events.push('consume');
    return {rows:mode==='replayed'?[]:[{last_consumed_counter:String(counter)}]};
   }
   if(sql.includes('UPDATE platform_admin_totp_factors')){
    events.push('activate');return {rows:[{staff_id:staffId}]};
   }
   throw Error('unexpected SQL');
  },
  release:()=>events.push('release'),
 };
 return {pool:{connect:async()=>client} as never,events};
}

test('verified enrollment activates factor only after replay watermark and commit',async()=>{
 const f=fixture('ok');
 assert.equal(await activateProvisionedAdminTotp(f.pool,staffId,code,async()=>key,now),true);
 assert.deepEqual(f.events,[
  'BEGIN','staff-lock','lockout','factor-lock','consume','activate','clear-failures','audit','COMMIT','release',
 ]);
});

test('missing or disabled factor cannot be activated',async()=>{
 const f=fixture('missing');
 assert.equal(await activateProvisionedAdminTotp(f.pool,staffId,code,async()=>key,now),false);
 assert.deepEqual(f.events,['BEGIN','staff-lock','lockout','factor-lock','ROLLBACK','release']);
});

test('invalid code commits a failure without activating the factor',async()=>{
 const f=fixture('ok');
 const bad=code==='999999'?'000000':'999999';
 assert.equal(await activateProvisionedAdminTotp(f.pool,staffId,bad,async()=>key,now),false);
 assert.deepEqual(f.events,['BEGIN','staff-lock','lockout','factor-lock','failure','audit','COMMIT','release']);
});

test('replayed enrollment code cannot activate',async()=>{
 const f=fixture('replayed');
 assert.equal(await activateProvisionedAdminTotp(f.pool,staffId,code,async()=>key,now),false);
 assert.deepEqual(f.events,['BEGIN','staff-lock','lockout','factor-lock','consume','failure','audit','COMMIT','release']);
});

test('commit failure never confirms activation',async()=>{
 const f=fixture('commit-fails');
 await assert.rejects(activateProvisionedAdminTotp(f.pool,staffId,code,async()=>key,now),
  /commit failed/);
 assert.equal(f.events.at(-1),'release');
 assert.ok(f.events.includes('ROLLBACK'));
});


test('locked MFA identity cannot attempt enrollment activation',async()=>{
 const f=fixture('locked');
 assert.equal(await activateProvisionedAdminTotp(f.pool,staffId,code,async()=>key,now),false);
 assert.deepEqual(f.events,['BEGIN','staff-lock','lockout','ROLLBACK','release']);
});

test('replayed enrollment rolls back failure counter when audit write fails',async()=>{
 const f=fixture('audit-fails');
 const bad=code==='999999'?'000000':'999999';
 await assert.rejects(
  activateProvisionedAdminTotp(f.pool,staffId,bad,async()=>key,now),
  /admin_mfa_audit_unavailable/,
 );
 assert.deepEqual(f.events,[
  'BEGIN','staff-lock','lockout','factor-lock','failure','audit','ROLLBACK','release',
 ]);
});

test('activation rejects timestamps outside supported Date range without SQL',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('unexpected');}} as never;
 assert.equal(await activateProvisionedAdminTotp(
  pool,staffId,code,async()=>key,8640000000000001,
 ),false);
 assert.equal(connections,0);
});
