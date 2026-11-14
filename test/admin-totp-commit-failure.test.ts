import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {attemptAdminTotpLogin} from '../src/modules/admin/admin-totp-login-attempt.js';

type Db=Pick<PoolClient,'query'>;
const staffId=randomUUID();
const secret=Buffer.from('12345678901234567890','ascii');
const pepper=randomBytes(32);
const now=59_000;

test('successful MFA session cannot be returned if commit fails',async()=>{
 const steps:string[]=[];
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>{
  const result=await work({query:async(sql:string)=>{
   if(sql.includes('SELECT locked_until')){
    steps.push('lockout');return {rows:[]};
   }
   if(sql.includes('INSERT INTO platform_admin_totp_replay')){
    steps.push('consume');return {rows:[{last_consumed_counter:'1'}]};
   }
   if(sql.includes('INSERT INTO platform_admin_sessions')){
    steps.push('session');return {rows:[{id:randomUUID()}]};
   }
   throw Error('unexpected SQL in MFA transaction');
  }} as Db);
  assert.ok(result);
  steps.push('commit-error');
  throw Error('commit failed');
 };
 await assert.rejects(attemptAdminTotpLogin(
  transaction,{staffId,secret},'287082',pepper,now,
 ),/commit failed/);
 assert.deepEqual(steps,['lockout','consume','session','commit-error']);
});

test('MFA commit failure after a failed code never reports successful authentication',async()=>{
 const steps:string[]=[];
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>{
  const result=await work({query:async(sql:string)=>{
   assert.match(sql,/INSERT INTO platform_admin_mfa_attempts/);
   steps.push('failure-recorded');
   return {rows:[{failed_attempts:1,locked_until:null}]};
  }} as Db);
  assert.equal(result?.failedAttempts,1);
  steps.push('commit-error');
  throw Error('failure audit commit failed');
 };
 await assert.rejects(attemptAdminTotpLogin(
  transaction,{staffId,secret},'000000',pepper,now,
 ),/failure audit commit failed/);
 assert.deepEqual(steps,['failure-recorded','commit-error']);
});
