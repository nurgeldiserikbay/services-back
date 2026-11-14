import {test} from 'node:test';
import type {PoolClient} from 'pg';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {attemptAdminTotpLogin} from '../src/modules/admin/admin-totp-login-attempt.js';

const staffId=randomUUID();
const secret=Buffer.from('12345678901234567890','ascii');
const pepper=randomBytes(32);
const now=59_000;
const authenticated={staffId,secret};
type Db=Pick<PoolClient,'query'>;

test('invalid TOTP is durably recorded without issuing a session',async()=>{
 const steps:string[]=[];
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>{
  steps.push('BEGIN');
  const value=await work({query:async(sql:string,params:unknown[])=>{
   assert.match(sql,/INSERT INTO platform_admin_mfa_attempts/);
   assert.equal(params[0],staffId);
   steps.push('failure');
   return {rows:[{failed_attempts:1,locked_until:null}]};
  }} as Db);
  steps.push('COMMIT');
  return value;
 };
 assert.equal(await attemptAdminTotpLogin(
  transaction,authenticated,'000000',pepper,now),null);
 assert.deepEqual(steps,['BEGIN','failure','COMMIT']);
});

test('valid TOTP passes through lockout and replay checks before session issuance',async()=>{
 const steps:string[]=[];
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>{
  const result=await work({query:async(sql:string)=>{
   if(sql.includes('SELECT locked_until')){
    steps.push('lockout');
    return {rows:[]};
   }
   if(sql.includes('INSERT INTO platform_admin_totp_replay')){
    steps.push('replay');
    return {rows:[{last_consumed_counter:'1'}]};
   }
   if(sql.includes('INSERT INTO platform_admin_sessions')){
    steps.push('session');
    return {rows:[{id:randomUUID()}]};
   }
   throw Error('unexpected query');
  }} as Db);
  steps.push('COMMIT');
  return result;
 };
 const result=await attemptAdminTotpLogin(
  transaction,authenticated,'287082',pepper,now);
 assert.ok(result);
 assert.deepEqual(steps,['lockout','replay','session','COMMIT']);
});

test('failure persistence outage fails closed',async()=>{
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>work({
  query:async()=>{throw Error('database unavailable');},
 } as Db);
 await assert.rejects(
  attemptAdminTotpLogin(transaction,authenticated,'000000',pepper,now),
  /database unavailable/,
 );
});

test('untrusted principal and invalid clock never reach the database',async()=>{
 let calls=0;
 const transaction=async <T>(_work:(db:Db)=>Promise<T>):Promise<T>=>{
  calls++;throw Error('unexpected transaction');
 };
 assert.equal(await attemptAdminTotpLogin(transaction,
  {...authenticated,staffId:'invalid'},'000000',pepper,now),null);
 assert.equal(await attemptAdminTotpLogin(transaction,
  authenticated,'000000',pepper,-1),null);
 assert.equal(await attemptAdminTotpLogin(transaction,
  authenticated,'000000',Buffer.alloc(1),now),null);
 assert.equal(calls,0);
});

test('malformed TOTP inputs count as failed attempts, not free guesses',async()=>{
 const codes:unknown[]=['28708','287082 ','287O82',287082,null,undefined];
 const recorded:unknown[]=[];
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>work({
  query:async(sql:string,params:unknown[])=>{
   assert.match(sql,/INSERT INTO platform_admin_mfa_attempts/);
   recorded.push(params[0]);
   return {rows:[{failed_attempts:1,locked_until:null}]};
  },
 } as Db);
 for(const code of codes)
  assert.equal(await attemptAdminTotpLogin(
   transaction,authenticated,code,pepper,now),null);
 assert.equal(recorded.length,codes.length);
 assert.ok(recorded.every(id=>id===staffId));
});

test('failed MFA transaction commit error never becomes successful login',async()=>{
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>{
  await work({query:async()=>({
   rows:[{failed_attempts:1,locked_until:null}],
  })} as Db);
  throw Error('commit failed');
 };
 await assert.rejects(
  attemptAdminTotpLogin(transaction,authenticated,'000000',pepper,now),
  /commit failed/,
 );
});

test('replayed valid TOTP never issues a privileged session',async()=>{
 const steps:string[]=[];
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>{
  try{
   const result=await work({query:async(sql:string)=>{
    if(sql.includes('SELECT locked_until')){
     steps.push('lockout');return {rows:[]};
    }
    if(sql.includes('INSERT INTO platform_admin_totp_replay')){
     steps.push('replay-denied');return {rows:[]};
    }
    throw Error('unexpected session query after replay denial');
   }} as Db);
   steps.push('COMMIT');
   return result;
  }catch(error){
   steps.push('ROLLBACK');
   throw error;
  }
 };
 assert.equal(await attemptAdminTotpLogin(
  transaction,authenticated,'287082',pepper,now,
 ),null);
 assert.deepEqual(steps,['lockout','replay-denied','ROLLBACK']);
});

test('session issuance denial rolls back consumed replay watermark',async()=>{
 const steps:string[]=[];
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>{
  try{
   const result=await work({query:async(sql:string)=>{
    if(sql.includes('SELECT locked_until')){
     steps.push('lockout');return {rows:[]};
    }
    if(sql.includes('INSERT INTO platform_admin_totp_replay')){
     steps.push('replay');return {rows:[{last_consumed_counter:'1'}]};
    }
    if(sql.includes('INSERT INTO platform_admin_sessions')){
     steps.push('session-denied');return {rows:[]};
    }
    throw Error('unexpected query');
   }} as Db);
   steps.push('COMMIT');return result;
  }catch(error){
   steps.push('ROLLBACK');throw error;
  }
 };
 assert.equal(await attemptAdminTotpLogin(
  transaction,authenticated,'287082',pepper,now,
 ),null);
 assert.deepEqual(steps,[
  'lockout','replay','session-denied','ROLLBACK',
 ]);
});

test('missing failed-attempt row is rejected rather than silently accepted',async()=>{
 let commits=0;
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>{
  const result=await work({query:async(sql:string)=>{
   assert.match(sql,/INSERT INTO platform_admin_mfa_attempts/);
   return {rows:[]};
  }} as Db);
  commits++;
  return result;
 };
 await assert.rejects(
  attemptAdminTotpLogin(transaction,authenticated,'000000',pepper,now),
  /admin_mfa_failure_record_missing/,
 );
 assert.equal(commits,1);
});

test('locked MFA account rejects valid code before replay or session SQL',async()=>{
 const steps:string[]=[];
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>{
  try{
   const value=await work({query:async(sql:string)=>{
    if(sql.includes('SELECT locked_until')){
     steps.push('lockout');
     return {rows:[{
      locked_until:new Date(now+60_000),
      failed_attempts:5,
      window_started_at:new Date(now-1_000),
     }]};
    }
    throw Error('replay or session query must not run during lockout');
   }} as Db);
   steps.push('COMMIT');return value;
  }catch(error){
   steps.push('ROLLBACK');throw error;
  }
 };
 assert.equal(await attemptAdminTotpLogin(
  transaction,authenticated,'287082',pepper,now,
 ),null);
 assert.deepEqual(steps,['lockout','ROLLBACK']);
});
