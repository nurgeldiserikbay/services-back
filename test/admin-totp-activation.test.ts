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

function fixture(mode:'ok'|'missing'|'replayed'|'commit-fails'){
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){
    events.push(sql);
    if(sql==='COMMIT'&&mode==='commit-fails')throw Error('commit failed');
    return {rows:[]};
   }
   if(sql.includes('pg_advisory_xact_lock')){
    events.push('staff-lock');return {rows:[{}]};
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
  'BEGIN','staff-lock','factor-lock','consume','activate','COMMIT','release',
 ]);
});

test('missing or disabled factor cannot be activated',async()=>{
 const f=fixture('missing');
 assert.equal(await activateProvisionedAdminTotp(f.pool,staffId,code,async()=>key,now),false);
 assert.deepEqual(f.events,['BEGIN','staff-lock','factor-lock','ROLLBACK','release']);
});

test('invalid code cannot activate or consume replay watermark',async()=>{
 const f=fixture('ok');
 const bad=code==='999999'?'000000':'999999';
 assert.equal(await activateProvisionedAdminTotp(f.pool,staffId,bad,async()=>key,now),false);
 assert.deepEqual(f.events,['BEGIN','staff-lock','factor-lock','ROLLBACK','release']);
});

test('replayed enrollment code cannot activate',async()=>{
 const f=fixture('replayed');
 assert.equal(await activateProvisionedAdminTotp(f.pool,staffId,code,async()=>key,now),false);
 assert.deepEqual(f.events,['BEGIN','staff-lock','factor-lock','consume','ROLLBACK','release']);
});

test('commit failure never confirms activation',async()=>{
 const f=fixture('commit-fails');
 await assert.rejects(activateProvisionedAdminTotp(f.pool,staffId,code,async()=>key,now),
  /commit failed/);
 assert.equal(f.events.at(-1),'release');
 assert.ok(f.events.includes('ROLLBACK'));
});
