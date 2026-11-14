import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {verifyTotpAndIssueAdminSession} from '../src/modules/admin/admin-totp-session-flow.js';

const staffId=randomUUID();
const secret=Buffer.from('12345678901234567890','ascii');
const pepper=randomBytes(32);
const now=59_000;
const authenticated={staffId,secret};

test('verified TOTP creates a session only after counter consumption and commit',async()=>{
 const steps:string[]=[];
 const transaction=async <T>(work:(db:never)=>Promise<T>):Promise<T>=>{
  steps.push('BEGIN');
  const result=await work({query:async(sql:string,params:unknown[])=>{
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
  }} as never);
  steps.push('COMMIT');
  return result;
 };
 const session=await verifyTotpAndIssueAdminSession(
  transaction,authenticated,'287082',pepper,now);
 assert.ok(session);
 assert.equal(session.token.length,43);
 assert.deepEqual(steps,['BEGIN','consume','session','COMMIT']);
});

test('wrong code and untrusted identities never open a transaction',async()=>{
 let calls=0;
 const transaction=async <T>(_work:(db:never)=>Promise<T>):Promise<T>=>{
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
 const transaction=async <T>(work:(db:never)=>Promise<T>):Promise<T>=>work({
  query:async(sql:string)=>{
   if(sql.includes('INSERT INTO platform_admin_sessions'))sessionWrites++;
   return {rows:[]};
  },
 } as never);
 assert.equal(await verifyTotpAndIssueAdminSession(
  transaction,authenticated,'287082',pepper,now),null);
 assert.equal(sessionWrites,0);
});

test('database failure is propagated instead of returning a session',async()=>{
 const transaction=async <T>(work:(db:never)=>Promise<T>):Promise<T>=>work({
  query:async()=>{throw Error('database unavailable');},
 } as never);
 await assert.rejects(
  verifyTotpAndIssueAdminSession(transaction,authenticated,'287082',pepper,now),
  /database unavailable/,
 );
});
