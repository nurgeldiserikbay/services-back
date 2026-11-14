import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {attemptAdminTotpLogin} from '../src/modules/admin/admin-totp-login-attempt.js';

const staffId=randomUUID();
const secret=Buffer.from('12345678901234567890','ascii');
const pepper=randomBytes(32);
const now=59_000;
const authenticated={staffId,secret};

test('invalid TOTP is durably recorded without issuing a session',async()=>{
 const steps:string[]=[];
 const transaction=async <T>(work:(db:never)=>Promise<T>):Promise<T>=>{
  steps.push('BEGIN');
  const value=await work({query:async(sql:string,params:unknown[])=>{
   assert.match(sql,/INSERT INTO platform_admin_mfa_attempts/);
   assert.equal(params[0],staffId);
   steps.push('failure');
   return {rows:[{failed_attempts:1,locked_until:null}]};
  }} as never);
  steps.push('COMMIT');
  return value;
 };
 assert.equal(await attemptAdminTotpLogin(
  transaction,authenticated,'000000',pepper,now),null);
 assert.deepEqual(steps,['BEGIN','failure','COMMIT']);
});

test('valid TOTP passes through lockout and replay checks before session issuance',async()=>{
 const steps:string[]=[];
 const transaction=async <T>(work:(db:never)=>Promise<T>):Promise<T>=>{
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
  }} as never);
  steps.push('COMMIT');
  return result;
 };
 const result=await attemptAdminTotpLogin(
  transaction,authenticated,'287082',pepper,now);
 assert.ok(result);
 assert.deepEqual(steps,['lockout','replay','session','COMMIT']);
});

test('failure persistence outage fails closed',async()=>{
 const transaction=async <T>(work:(db:never)=>Promise<T>):Promise<T>=>work({
  query:async()=>{throw Error('database unavailable');},
 } as never);
 await assert.rejects(
  attemptAdminTotpLogin(transaction,authenticated,'000000',pepper,now),
  /database unavailable/,
 );
});

test('untrusted principal and invalid clock never reach the database',async()=>{
 let calls=0;
 const transaction=async <T>(_work:(db:never)=>Promise<T>):Promise<T>=>{
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
