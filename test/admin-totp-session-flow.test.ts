import {test} from 'node:test';
import type {PoolClient} from 'pg';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {verifyTotpAndIssueAdminSession,verifyTotpWithDurableFailureAccounting} from '../src/modules/admin/admin-totp-session-flow.js';

const staffId=randomUUID();
const secret=Buffer.from('12345678901234567890','ascii');
const pepper=randomBytes(32);
const now=59_000;
const authenticated={staffId,secret};
type Db=Pick<PoolClient,'query'>;

test('verified TOTP creates a session only after counter consumption and commit',async()=>{
 const steps:string[]=[];
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>{
  steps.push('BEGIN');
  const result=await work({query:async(sql:string,params:unknown[])=>{
   if(sql.includes('SELECT locked_until')){steps.push('lockout');return {rows:[]};}
   if(sql.includes('INSERT INTO platform_admin_totp_replay')){
    steps.push('consume');
    assert.deepEqual(params,[staffId,1]);
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
 const session=await verifyTotpAndIssueAdminSession(
  transaction,authenticated,'287082',pepper,now);
 assert.ok(session);
 assert.equal(session.token.length,43);
 assert.deepEqual(steps,['BEGIN','lockout','consume','session','COMMIT']);
});

test('wrong code and untrusted identities never open a transaction',async()=>{
 let calls=0;
 const transaction=async <T>(_work:(db:Db)=>Promise<T>):Promise<T>=>{
  calls++;
  throw Error('unexpected transaction');
 };
 for(const [identity,code] of [
  [authenticated,'000000'],
  [authenticated,287082],
  [{...authenticated,staffId:'invalid'},'287082'],
  [{...authenticated,role:'owner'},'287082'],
  [{staffId,secret:Buffer.alloc(0)},'287082'],
 ] as const){
  assert.equal(await verifyTotpAndIssueAdminSession(
   transaction,identity as never,code,pepper,now),null);
 }
 assert.equal(calls,0);
});

test('replayed TOTP cannot create a privileged session',async()=>{
 let sessionWrites=0;
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>work({
  query:async(sql:string)=>{
   if(sql.includes('INSERT INTO platform_admin_sessions'))sessionWrites++;
   return {rows:[]};
  },
 } as Db);
 assert.equal(await verifyTotpAndIssueAdminSession(
  transaction,authenticated,'287082',pepper,now),null);
 assert.equal(sessionWrites,0);
});

test('database failure is propagated instead of returning a session',async()=>{
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>work({
  query:async()=>{throw Error('database unavailable');},
 } as Db);
 await assert.rejects(
  verifyTotpAndIssueAdminSession(transaction,authenticated,'287082',pepper,now),
  /database unavailable/,
 );
});

test('invalid cryptographic inputs and clock never start a transaction',async()=>{
 let calls=0;
 const transaction=async <T>(_work:(db:Db)=>Promise<T>):Promise<T>=>{
  calls++;throw Error('unexpected transaction');
 };
 assert.equal(await verifyTotpAndIssueAdminSession(
  transaction,authenticated,'287082',Buffer.alloc(1),now),null);
 assert.equal(await verifyTotpAndIssueAdminSession(
  transaction,authenticated,'287082',pepper,-1),null);
 assert.equal(await verifyTotpAndIssueAdminSession(
  transaction,authenticated,'287082',pepper,Number.NaN),null);
 assert.equal(await verifyTotpAndIssueAdminSession(
  transaction,{...authenticated,secret:Buffer.alloc(129)},
  '287082',pepper,now),null);
 assert.equal(calls,0);
});


test('wrong OTP is recorded and committed in an independent transaction',async()=>{
 const steps:string[]=[];
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>{
  steps.push('BEGIN');
  const result=await work({query:async(sql:string,params:unknown[])=>{
   assert.match(sql,/INSERT INTO platform_admin_mfa_attempts/);
   assert.equal(params[0],staffId);
   steps.push('record failure');
   return {rows:[{failed_attempts:1,locked_until:null}]};
  }} as Db);
  steps.push('COMMIT');
  return result;
 };
 assert.equal(await verifyTotpWithDurableFailureAccounting(
  transaction,authenticated,'000000',pepper,now),null);
 assert.deepEqual(steps,['BEGIN','record failure','COMMIT']);
});

test('failed OTP database errors propagate instead of silently bypassing lockout',async()=>{
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>work({
  query:async()=>{throw Error('attempt storage unavailable');},
 } as Db);
 await assert.rejects(verifyTotpWithDurableFailureAccounting(
  transaction,authenticated,'000000',pepper,now),/attempt storage unavailable/);
});

test('invalid trusted identity cannot record attempts or issue sessions',async()=>{
 let transactions=0;
 const transaction=async <T>(_work:(db:Db)=>Promise<T>):Promise<T>=>{
  transactions++;throw Error('unexpected transaction');
 };
 assert.equal(await verifyTotpWithDurableFailureAccounting(
  transaction,{staffId:'bad',secret},'000000',pepper,now),null);
 assert.equal(await verifyTotpWithDurableFailureAccounting(
  transaction,authenticated,'000000',Buffer.alloc(1),now),null);
 assert.equal(transactions,0);
});

test('valid OTP still consumes counter and creates a session atomically',async()=>{
 const steps:string[]=[];
 const transaction=async <T>(work:(db:Db)=>Promise<T>):Promise<T>=>{
  steps.push('BEGIN');
  const result=await work({query:async(sql:string)=>{
   if(sql.includes('SELECT locked_until')){steps.push('lockout');return {rows:[]};}
   if(sql.includes('INSERT INTO platform_admin_totp_replay')){
    steps.push('consume');return {rows:[{last_consumed_counter:'1'}]};
   }
   if(sql.includes('INSERT INTO platform_admin_sessions')){
    steps.push('session');return {rows:[{id:randomUUID()}]};
   }
   throw Error('unexpected query');
  }} as Db);
  steps.push('COMMIT');return result;
 };
 const session=await verifyTotpWithDurableFailureAccounting(
  transaction,authenticated,'287082',pepper,now);
 assert.ok(session);
 assert.deepEqual(steps,['BEGIN','lockout','consume','session','COMMIT']);
});
