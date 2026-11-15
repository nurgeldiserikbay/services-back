import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {sealAdminTotpSecret} from '../src/modules/admin/admin-totp-secret.js';
import {activateAdminTotpInTransaction} from '../src/modules/admin/admin-totp-activation-transaction.js';

const staffId=randomUUID();
const key=randomBytes(32);
const secret=randomBytes(32);
const now=123456*30000;
const input=Buffer.alloc(8);
input.writeBigUInt64BE(BigInt(now/30000));
const digest=createHmac('sha1',secret).update(input).digest();
const offset=digest[digest.length-1]!&15;
const code=String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
const envelope=sealAdminTotpSecret(secret,staffId,key);
const primary={staffId,authenticatedAt:now-1000};

function fixture(locked=false){
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql.startsWith('SET LOCAL ')){
    assert.ok(["SET LOCAL lock_timeout = '3s'","SET LOCAL statement_timeout = '8s'"].includes(sql));
    events.push(sql.includes('lock_timeout')?'lock-timeout':'statement-timeout');
    return {rows:[]};
   }
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)){
    events.push(sql);return {rows:[]};
   }
   if(sql.includes('pg_advisory_xact_lock')){
    events.push('serialize');return {rows:[{}]};
   }
   if(sql.trimStart().startsWith('SELECT locked_until,failed_attempts,window_started_at')&&sql.includes('FROM platform_admin_mfa_attempts')){
    events.push('lockout');return {rows:locked?[{locked_until:new Date(now+60000),failed_attempts:5,window_started_at:new Date(now-1000)}]:[]};
   }
   if(sql.includes('FOR UPDATE OF factor')){
    events.push('factor');return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
   }
   if(sql.includes('platform_admin_totp_replay')){
    events.push('consume');return {rows:[{last_consumed_counter:String(now/30000)}]};
   }
   if(sql.includes('UPDATE platform_admin_totp_factors')){
    events.push('activate');return {rows:[{staff_id:staffId}]};
   }
   if(sql.includes('INSERT INTO platform_admin_mfa_attempts')){
    events.push('failure');return {rows:[{failed_attempts:1,locked_until:null}]};
   }
   if(sql.includes('DELETE FROM platform_admin_mfa_attempts')){
    events.push('reset');return {rows:[]};
   }
   throw Error('unexpected query');
  },
  release:()=>events.push('release'),
 };
 return {pool:{connect:async()=>client} as never,events};
}

test('valid enrollment proof commits replay watermark, activation and reset',async()=>{
 const f=fixture();
 assert.equal(await activateAdminTotpInTransaction(
  f.pool,primary,code,async()=>key,now,
 ),true);
 assert.deepEqual(f.events,[
  'BEGIN','lock-timeout','statement-timeout','serialize','lockout','factor','consume','activate','reset','COMMIT','release',
 ]);
});
test('bad enrollment code commits a failure without activating',async()=>{
 const f=fixture();
 assert.equal(await activateAdminTotpInTransaction(
  f.pool,primary,code==='999999'?'000000':'999999',async()=>key,now,
 ),false);
 assert.deepEqual(f.events,[
  'BEGIN','lock-timeout','statement-timeout','serialize','lockout','factor','failure','COMMIT','release',
 ]);
});
test('locked enrollment is rejected before reading factor',async()=>{
 const f=fixture(true);
 assert.equal(await activateAdminTotpInTransaction(
  f.pool,primary,code,async()=>key,now,
 ),false);
 assert.deepEqual(f.events,[
  'BEGIN','lock-timeout','statement-timeout','serialize','lockout','ROLLBACK','release',
 ]);
});
test('invalid staff identifier never opens a database connection',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('should not connect');}} as never;
 assert.equal(await activateAdminTotpInTransaction(
  pool,{staffId:'not-a-uuid',authenticatedAt:now-1000},code,async()=>key,now,
 ),false);
 assert.equal(connections,0);
});

test('stale primary authentication is rejected before database access',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('should not connect');}} as never;
 assert.equal(await activateAdminTotpInTransaction(
  pool,{staffId,authenticatedAt:now-300001},code,async()=>key,now,
 ),false);
 assert.equal(connections,0);
});

test('failed enrollment COMMIT discards uncertain connection',async()=>{
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='COMMIT'){events.push('COMMIT');throw Error('commit failed');}
   if(sql==='BEGIN'){events.push('BEGIN');return {rows:[]};}
   if(sql.startsWith('SET LOCAL ')){
    events.push(sql.includes('lock_timeout')?'lock-timeout':'statement-timeout');
    return {rows:[]};
   }
   if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
   if(sql.includes('FROM platform_admin_mfa_attempts'))return {rows:[]};
   if(sql.includes('FOR UPDATE OF factor'))return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
   if(sql.includes('platform_admin_totp_replay'))return {rows:[{last_consumed_counter:String(now/30000)}]};
   if(sql.includes('UPDATE platform_admin_totp_factors'))return {rows:[{staff_id:staffId}]};
   if(sql.includes('DELETE FROM platform_admin_mfa_attempts'))return {rows:[]};
   throw Error('unexpected SQL');
  },
  release:(broken?:boolean)=>events.push('release:'+String(broken)),
 };
 await assert.rejects(
  activateAdminTotpInTransaction({connect:async()=>client} as never,primary,code,async()=>key,now),
  /commit failed/,
 );
 assert.deepEqual(events,['BEGIN','lock-timeout','statement-timeout','COMMIT','release:true']);
});

test('invalid enrollment pool and resolver never connect',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('unexpected connection');}} as never;
 for(const invalidPool of [null,undefined,{}, {connect:null}]){
  assert.equal(await activateAdminTotpInTransaction(invalidPool as never,primary,code,async()=>key,now),false);
 }
 assert.equal(await activateAdminTotpInTransaction(pool,primary,code,null as never,now),false);
 assert.equal(connections,0);
});

test('locked enrollment rollback failure discards connection without retry',async()=>{
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'){events.push('BEGIN');return {rows:[]};}
   if(sql.startsWith('SET LOCAL ')){
    events.push(sql.includes('lock_timeout')?'lock-timeout':'statement-timeout');
    return {rows:[]};
   }
   if(sql.includes('pg_advisory_xact_lock')){events.push('lock');return {rows:[{}]};}
   if(sql.includes('FROM platform_admin_mfa_attempts')){
    events.push('lockout');
    return {rows:[{locked_until:new Date(now+60000),failed_attempts:5,window_started_at:new Date(now-1000)}]};
   }
   if(sql==='ROLLBACK'){events.push('ROLLBACK');throw Error('rollback unavailable');}
   throw Error('unexpected SQL');
  },
  release:(broken?:boolean)=>events.push('release:'+String(broken)),
 };
 await assert.rejects(
  activateAdminTotpInTransaction({connect:async()=>client} as never,primary,code,async()=>key,now),
  /rollback unavailable/,
 );
 assert.deepEqual(events,['BEGIN','lock-timeout','statement-timeout','lock','lockout','ROLLBACK','release:true']);
});

test('failed enrollment BEGIN discards uncertain database connection',async()=>{
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{events.push(sql);throw Error('begin failed');},
  release:(broken?:boolean)=>events.push('release:'+String(broken)),
 };
 await assert.rejects(
  activateAdminTotpInTransaction({connect:async()=>client} as never,primary,code,async()=>key,now),
  /begin failed/,
 );
 assert.deepEqual(events,['BEGIN','release:true']);
});

test('enrollment failure with failed rollback discards connection and preserves original error',async()=>{
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'){events.push('BEGIN');return {rows:[]};}
   if(sql.startsWith('SET LOCAL ')){
    events.push(sql.includes('lock_timeout')?'lock-timeout':'statement-timeout');
    return {rows:[]};
   }
   if(sql.includes('pg_advisory_xact_lock')){
    events.push('lock');throw Error('lock failed');
   }
   if(sql==='ROLLBACK'){events.push('ROLLBACK');throw Error('rollback failed');}
   throw Error('unexpected SQL');
  },
  release:(broken?:boolean)=>events.push('release:'+String(broken)),
 };
 await assert.rejects(
  activateAdminTotpInTransaction({connect:async()=>client} as never,primary,code,async()=>key,now),
  /lock failed/,
 );
 assert.deepEqual(events,[
  'BEGIN','lock-timeout','statement-timeout','lock','ROLLBACK','release:true',
 ]);
});
