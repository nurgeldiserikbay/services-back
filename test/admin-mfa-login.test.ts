import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {sealAdminTotpSecret} from '../src/modules/admin/admin-totp-secret.js';
import {loginAdminWithProvisionedTotp} from '../src/modules/admin/admin-mfa-login.js';

const staffId=randomUUID();
const secret=randomBytes(32);
const key=randomBytes(32);
const pepper=randomBytes(32);
const now=123456*30000;
const input=Buffer.alloc(8);
input.writeBigUInt64BE(BigInt(now/30000));
const digest=createHmac('sha1',secret).update(input).digest();
const offset=digest[digest.length-1]!&15;
const code=String((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,'0');
const envelope=sealAdminTotpSecret(secret,staffId,key);
const primary={staffId,authenticatedAt:now-1000};

function fixture(mode:'ok'|'disabled'|'bad-code'|'commit-fails'){
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql.startsWith('SET LOCAL ')){events.push(sql);return {rows:[]};}
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)){
    events.push(sql);
    if(sql==='COMMIT'&&mode==='commit-fails')throw Error('commit failed');
    return {rows:[]};
   }
   if(sql.includes('INSERT INTO platform_admin_security_events')){
    events.push('audit');return {rows:[{id:randomUUID()}]};
   }
   if(sql.includes('pg_advisory_xact_lock')){events.push('staff-lock');return {rows:[{}]};}
   if(sql.includes('DELETE FROM platform_admin_mfa_attempts')){
    events.push('clear-failures');return {rows:[]};
   }
   if(sql.includes('FROM platform_admin_mfa_attempts')){
    events.push('lockout');return {rows:[]};
   }
   if(sql.includes('FOR SHARE OF factor')){
    assert.match(sql,/staff\.role IN \('owner','admin','operator','auditor'\)/);
    assert.match(sql,/EXISTS \(SELECT 1 FROM platform_admin_grants grants/);
    events.push('factor-lock');
    return {rows:mode==='disabled'?[]:[{staff_id:staffId}]};
   }
   if(sql.includes('factor.encrypted_secret')){
    events.push('load-factor');
    return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
   }
   if(sql.includes('platform_admin_totp_replay')){
    events.push('consume');
    return {rows:[{last_consumed_counter:String(now/30000)}]};
   }
   if(sql.includes('INSERT INTO platform_admin_mfa_attempts')){
    events.push('failure');return {rows:[{failed_attempts:1,locked_until:null}]};
   }
   if(sql.includes('INSERT INTO platform_admin_sessions')){
    events.push('session');return {rows:[{id:randomUUID()}]};
   }
   throw Error('unexpected SQL');
  },
  release:()=>events.push('release'),
 };
 return {pool:{connect:async()=>client} as never,events};
}
test('admin login locks factor and commits before returning bearer',async()=>{
 const f=fixture('ok');
 const result=await loginAdminWithProvisionedTotp(
  f.pool,primary,code,async()=>key,pepper,now,
 );
 assert.ok(result?.token);
 assert.deepEqual(f.events,[
  'BEGIN',"SET LOCAL lock_timeout = '3s'","SET LOCAL statement_timeout = '8s'",'staff-lock','lockout','factor-lock','load-factor',
  'consume','session','clear-failures','audit','COMMIT','release',
 ]);
});
test('disabled factor never loads secret or issues session',async()=>{
 const f=fixture('disabled');
 assert.equal(await loginAdminWithProvisionedTotp(
  f.pool,primary,code,async()=>key,pepper,now,
 ),null);
 assert.deepEqual(f.events,[
  'BEGIN',"SET LOCAL lock_timeout = '3s'","SET LOCAL statement_timeout = '8s'",'staff-lock','lockout','factor-lock','ROLLBACK','release',
 ]);
});
test('invalid TOTP commits a failure without creating a session',async()=>{
 const f=fixture('bad-code');
 const bad=code==='999999'?'000000':'999999';
 assert.equal(await loginAdminWithProvisionedTotp(
  f.pool,primary,bad,async()=>key,pepper,now,
 ),null);
 assert.deepEqual(f.events,[
  'BEGIN',"SET LOCAL lock_timeout = '3s'","SET LOCAL statement_timeout = '8s'",'staff-lock','lockout','factor-lock','load-factor',
  'failure','audit','COMMIT','release',
 ]);
});
test('commit failure never releases a bearer',async()=>{
 const f=fixture('commit-fails');
 await assert.rejects(loginAdminWithProvisionedTotp(
  f.pool,primary,code,async()=>key,pepper,now,
 ),/commit failed/);
 assert.equal(f.events.at(-1),'release');
 assert.ok(f.events.includes('ROLLBACK'));
});

test('malformed MFA code is counted after a valid primary assertion',async()=>{
 const f=fixture('bad-code');
 assert.equal(await loginAdminWithProvisionedTotp(
  f.pool,primary,'12x',async()=>key,pepper,now,
 ),null);
 assert.deepEqual(f.events,[
  'BEGIN',"SET LOCAL lock_timeout = '3s'","SET LOCAL statement_timeout = '8s'",'staff-lock','lockout','factor-lock','load-factor',
  'failure','audit','COMMIT','release',
 ]);
});

test('malformed primary attestation is rejected before database connection',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('unexpected database access');}} as never;
 for(const malformed of [
  null,
  {staffId,authenticatedAt:now-1000,role:'owner'},
  Object.assign(Object.create(null),{staffId,authenticatedAt:now-1000}),
  {staffId,authenticatedAt:now+1},
  {staffId,authenticatedAt:now-300001},
 ]){
  assert.equal(await loginAdminWithProvisionedTotp(
   pool,malformed as never,code,async()=>key,pepper,now,
  ),null);
 }
 assert.equal(connections,0);
});

test('invalid key resolver is rejected before opening database',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('unexpected database access');}} as never;
 assert.equal(await loginAdminWithProvisionedTotp(
  pool,primary,code,null as never,pepper,now,
 ),null);
 assert.equal(connections,0);
});
test('session expiry overflow is rejected before opening database',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('unexpected database access');}} as never;
 const late=Number.MAX_SAFE_INTEGER-1000;
 assert.equal(await loginAdminWithProvisionedTotp(
  pool,{staffId,authenticatedAt:late-1000},code,async()=>key,pepper,late,
 ),null);
 assert.equal(connections,0);
});

test('timestamps beyond supported Date range fail before database connection',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('unexpected');}} as never;
 const late=8640000000000000-1000;
 assert.equal(await loginAdminWithProvisionedTotp(
  pool,{staffId,authenticatedAt:late-1000},code,async()=>key,pepper,late,
 ),null);
 assert.equal(connections,0);
});


test('invalid privileged session secrets and primary timestamps never open database',async()=>{
 let connections=0;
 const pool={connect:async()=>{connections++;throw Error('unexpected database access');}} as never;
 for(const invalidPepper of [Buffer.alloc(0),Buffer.alloc(31),Buffer.alloc(33),null,'secret']){
  assert.equal(await loginAdminWithProvisionedTotp(
   pool,primary,code,async()=>key,invalidPepper as Buffer,now,
  ),null);
 }
 for(const invalidNow of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
  assert.equal(await loginAdminWithProvisionedTotp(
   pool,primary,code,async()=>key,pepper,invalidNow,
  ),null);
 }
 for(const invalidTime of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
  assert.equal(await loginAdminWithProvisionedTotp(
   pool,{staffId,authenticatedAt:invalidTime},code,async()=>key,pepper,now,
  ),null);
 }
 assert.equal(connections,0);
});


test('failed rollback discards an uncertain admin MFA database connection',async()=>{
 const released:unknown[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'||sql.startsWith('SET LOCAL '))return {rows:[]};
   if(sql.includes('pg_advisory_xact_lock'))throw Error('transaction failed');
   if(sql==='ROLLBACK')throw Error('rollback failed');
   throw Error('unexpected SQL');
  },
  release:(error?:unknown)=>released.push(error),
 };
 const pool={connect:async()=>client} as never;
 await assert.rejects(loginAdminWithProvisionedTotp(
  pool,primary,code,async()=>key,pepper,now,
 ),/transaction failed/);
 assert.equal(released.length,1);
 assert.ok(released[0] instanceof Error);
 assert.match((released[0] as Error).message,/transaction outcome uncertain/i);
});

test('successful rollback returns admin MFA database connection normally',async()=>{
 const released:unknown[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL '))return {rows:[]};
   if(sql.includes('pg_advisory_xact_lock'))throw Error('transaction failed');
   throw Error('unexpected SQL');
  },
  release:(error?:unknown)=>released.push(error),
 };
 await assert.rejects(loginAdminWithProvisionedTotp(
  {connect:async()=>client} as never,primary,code,async()=>key,pepper,now,
 ),/transaction failed/);
 assert.deepEqual(released,[undefined]);
});


test('uncertain MFA commit discards the database connection even if rollback succeeds',async()=>{
 const releases:unknown[]=[];
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   events.push(sql);
   if(sql==='BEGIN'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL '))return {rows:[]};
   if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
   if(sql.includes('FROM platform_admin_mfa_attempts'))return {rows:[]};
   if(sql.includes('factor.encrypted_secret'))
    return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
   if(sql.includes('FOR SHARE OF factor'))return {rows:[{staff_id:staffId}]};
   if(sql.includes('platform_admin_totp_replay'))
    return {rows:[{last_consumed_counter:String(now/30000)}]};
   if(sql.includes('INSERT INTO platform_admin_sessions'))
    return {rows:[{id:randomUUID()}]};
   if(sql.includes('DELETE FROM platform_admin_mfa_attempts'))
    return {rows:[]};
   if(sql.includes('INSERT INTO platform_admin_security_events'))
    return {rows:[{id:randomUUID()}]};
   if(sql==='COMMIT')throw Error('commit uncertain');
   throw Error('unexpected SQL');
  },
  release:(error?:unknown)=>releases.push(error),
 };
 await assert.rejects(loginAdminWithProvisionedTotp(
  {connect:async()=>client} as never,primary,code,async()=>key,pepper,now,
 ),/commit uncertain/);
 assert.ok(events.includes('ROLLBACK'));
 assert.equal(releases.length,1);
 assert.ok(releases[0] instanceof Error);
});


test('failed-MFA attempt commit error discards connection without returning success',async()=>{
 const released:unknown[]=[];
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL ')){events.push(sql);return {rows:[]};}
   if(sql==='COMMIT'){events.push(sql);throw Error('attempt commit uncertain');}
   if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
   if(sql.includes('FROM platform_admin_mfa_attempts'))return {rows:[]};
   if(sql.includes('factor.encrypted_secret'))
    return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
   if(sql.includes('FOR SHARE OF factor'))return {rows:[{staff_id:staffId}]};
   if(sql.includes('INSERT INTO platform_admin_mfa_attempts'))
    return {rows:[{failed_attempts:1,locked_until:null}]};
   if(sql.includes('INSERT INTO platform_admin_security_events'))
    return {rows:[{id:randomUUID()}]};
   throw Error('unexpected SQL');
  },
  release:(error?:unknown)=>released.push(error),
 };
 const bad=code==='999999'?'000000':'999999';
 await assert.rejects(loginAdminWithProvisionedTotp(
  {connect:async()=>client} as never,primary,bad,async()=>key,pepper,now,
 ),/attempt commit uncertain/);
 assert.ok(events.includes('COMMIT'));
 assert.ok(events.includes('ROLLBACK'));
 assert.equal(released.length,1);
 assert.ok(released[0] instanceof Error);
});


test('admin MFA transaction applies bounded lock and statement timeouts before staff lock',async()=>{
 const f=fixture('ok');
 const result=await loginAdminWithProvisionedTotp(
  f.pool,primary,code,async()=>key,pepper,now,
 );
 assert.ok(result);
 assert.deepEqual(f.events.slice(0,4),[
  'BEGIN',"SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '8s'",'staff-lock',
 ]);
});

test('admin MFA transaction setup failure rolls back without issuing a session',async()=>{
 const statements:string[]=[];
 const releases:unknown[]=[];
 const client={
  query:async(sql:string)=>{
   statements.push(sql);
   if(sql==="SET LOCAL statement_timeout = '8s'")throw Error('timeout setup unavailable');
   return {rows:[]};
  },
  release:(error?:unknown)=>releases.push(error),
 };
 await assert.rejects(loginAdminWithProvisionedTotp(
  {connect:async()=>client} as never,primary,code,async()=>key,pepper,now,
 ),/timeout setup unavailable/);
 assert.deepEqual(statements,[
  'BEGIN',"SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '8s'",'ROLLBACK',
 ]);
 assert.deepEqual(releases,[undefined]);
});


test('failed BEGIN discards admin MFA connection and never attempts further SQL',async()=>{
 const statements:string[]=[];
 const released:unknown[]=[];
 const client={
  query:async(sql:string)=>{
   statements.push(sql);
   throw Error('begin outcome uncertain');
  },
  release:(error?:unknown)=>released.push(error),
 };
 await assert.rejects(loginAdminWithProvisionedTotp(
  {connect:async()=>client} as never,primary,code,async()=>key,pepper,now,
 ),/begin outcome uncertain/);
 assert.deepEqual(statements,['BEGIN']);
 assert.equal(released.length,1);
 assert.ok(released[0] instanceof Error);
});

test('missing durable MFA failure row rolls back and never commits',async()=>{
 const events:string[]=[];
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL ')){
    events.push(sql);return {rows:[]};
   }
   if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
   if(sql.includes('FROM platform_admin_mfa_attempts'))return {rows:[]};
   if(sql.includes('FOR SHARE OF factor'))return {rows:[{staff_id:staffId}]};
   if(sql.includes('factor.encrypted_secret'))
    return {rows:[{encrypted_secret:envelope,key_version:'key-1'}]};
   if(sql.includes('INSERT INTO platform_admin_mfa_attempts')){
    events.push('failure-no-row');return {rows:[]};
   }
   throw Error('unexpected SQL');
  },
  release:()=>events.push('release'),
 };
 const bad=code==='999999'?'000000':'999999';
 await assert.rejects(loginAdminWithProvisionedTotp(
  {connect:async()=>client} as never,primary,bad,
  async()=>key,pepper,now,
 ),/admin_mfa_failure_record_missing/);
 assert.ok(events.includes('ROLLBACK'));
 assert.ok(!events.includes('COMMIT'));
 assert.equal(events.at(-1),'release');
});

test('failed explicit rollback discards uncertain MFA connection',async()=>{
 const releases:unknown[]=[];
 let rollbackCalls=0;
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'||sql.startsWith('SET LOCAL '))return {rows:[]};
   if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
   if(sql.includes('FROM platform_admin_mfa_attempts'))return {rows:[]};
   if(sql.includes('FOR SHARE OF factor'))return {rows:[]};
   if(sql==='ROLLBACK'){
    rollbackCalls++;
    if(rollbackCalls===1)throw Error('rollback connection lost');
    return {rows:[]};
   }
   throw Error('unexpected SQL');
  },
  release:(error?:unknown)=>releases.push(error),
 };
 await assert.rejects(loginAdminWithProvisionedTotp(
  {connect:async()=>client} as never,primary,code,async()=>key,pepper,now,
 ),/rollback connection lost/);
 assert.equal(releases.length,1);
 assert.ok(releases[0] instanceof Error);
 assert.match((releases[0] as Error).message,/outcome uncertain/);
});
