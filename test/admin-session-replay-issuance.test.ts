import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {issueReplayProtectedAdminSession} from '../src/modules/admin/admin-session-replay-issuance.js';

const staffId=randomUUID();
const pepper=randomBytes(32);
const now=Date.now();
const verified={staffId,mfaVerifiedAt:now,totpCounter:12345};

test('admin session issuance consumes TOTP before issuing a bearer and waits for commit',async()=>{
 const statements:string[]=[];
 const transaction=async <T>(work:(db:never)=>Promise<T>):Promise<T>=>{
  statements.push('BEGIN');
  const result=await work({query:async(sql:string)=>{
   if(sql.includes('SELECT locked_until')){statements.push('lockout');return {rows:[]};}
   if(sql.includes('INSERT INTO platform_admin_totp_replay')){
    statements.push('consume');
    return {rows:[{last_consumed_counter:'12345'}]};
   }
   if(sql.includes('INSERT INTO platform_admin_sessions')){
    statements.push('issue');
    return {rows:[{id:randomUUID()}]};
   }
   throw Error('unexpected query');
  }} as never);
  statements.push('COMMIT');
  return result;
 };
 const session=await issueReplayProtectedAdminSession(transaction,verified,pepper,now);
 assert.ok(session);
 assert.equal(session.token.length,43);
 assert.deepEqual(statements,['BEGIN','lockout','consume','issue','COMMIT']);
});

test('replayed TOTP counter cannot issue a session and transaction rolls back',async()=>{
 const statements:string[]=[];
 const transaction=async <T>(work:(db:never)=>Promise<T>):Promise<T>=>{
  try{
   return await work({query:async(sql:string)=>{
    if(sql.includes('SELECT locked_until'))return {rows:[]};
    statements.push(sql.includes('platform_admin_totp_replay')?'consume':'issue');
    return {rows:[]};
   }} as never);
  }catch(error){
   statements.push('ROLLBACK');
   throw error;
  }
 };
 assert.equal(await issueReplayProtectedAdminSession(transaction,verified,pepper,now),null);
 assert.deepEqual(statements,['consume','ROLLBACK']);
});

test('session denial after counter consumption rolls back both operations',async()=>{
 const statements:string[]=[];
 const transaction=async <T>(work:(db:never)=>Promise<T>):Promise<T>=>{
  try{
   return await work({query:async(sql:string)=>{
    if(sql.includes('SELECT locked_until'))return {rows:[]};
    if(sql.includes('platform_admin_totp_replay')){
     statements.push('consume');
     return {rows:[{last_consumed_counter:'12345'}]};
    }
    statements.push('issue');
    return {rows:[]};
   }} as never);
  }catch(error){
   statements.push('ROLLBACK');
   throw error;
  }
 };
 assert.equal(await issueReplayProtectedAdminSession(transaction,verified,pepper,now),null);
 assert.deepEqual(statements,['consume','issue','ROLLBACK']);
});

test('invalid or browser-shaped assertions do not enter a transaction',async()=>{
 let calls=0;
 const transaction=async <T>(_work:(db:never)=>Promise<T>):Promise<T>=>{
  calls++;
  throw Error('unexpected transaction');
 };
 for(const value of [
  {...verified,totpCounter:-1},
  {...verified,totpCounter:1.5},
  {...verified,mfaVerifiedAt:now+1},
  {...verified,mfaVerifiedAt:-1},
  {...verified,mfaVerifiedAt:now-900001},
  {...verified,otp:'123456'},
  Object.assign(Object.create(null),verified),
  {staffId,mfaVerifiedAt:now},
 ]){
  assert.equal(await issueReplayProtectedAdminSession(
   transaction,value as never,pepper,now),null);
 }
 assert.equal(calls,0);
});

test('database failures propagate instead of issuing a bearer',async()=>{
 const transaction=async <T>(work:(db:never)=>Promise<T>):Promise<T>=>work({
  query:async()=>{throw Error('database unavailable');},
 } as never);
 await assert.rejects(
  issueReplayProtectedAdminSession(transaction,verified,pepper,now),
  /database unavailable/,
 );
});


test('commit failure never releases an admin bearer',async()=>{
 const transaction=async <T>(work:(db:never)=>Promise<T>):Promise<T>=>{
  await work({query:async(sql:string)=>{
   if(sql.includes('SELECT locked_until'))return {rows:[]};
   if(sql.includes('platform_admin_totp_replay'))
    return {rows:[{last_consumed_counter:'12345'}]};
   if(sql.includes('platform_admin_sessions'))
    return {rows:[{id:randomUUID()}]};
   throw Error('unexpected query');
  }} as never);
  throw Error('commit failed');
 };
 await assert.rejects(
  issueReplayProtectedAdminSession(transaction,verified,pepper,now),
  /commit failed/,
 );
});

test('out-of-range clock rejects before opening a transaction',async()=>{
 let calls=0;
 const transaction=async <T>(_work:(db:never)=>Promise<T>):Promise<T>=>{
  calls++;
  throw Error('unexpected transaction');
 };
 const late=8_640_000_000_000_000-1000;
 assert.equal(await issueReplayProtectedAdminSession(
  transaction,{...verified,mfaVerifiedAt:late},pepper,late),null);
 assert.equal(calls,0);
});

test('active MFA lockout prevents replay consumption and session issuance',async()=>{
 const statements:string[]=[];
 const transaction=async <T>(work:(db:never)=>Promise<T>):Promise<T>=>{
  try{
   return await work({query:async(sql:string)=>{
    statements.push(sql.includes('SELECT locked_until')?'lockout':'write');
    if(sql.includes('SELECT locked_until'))
     return {rows:[{locked_until:new Date(now+60_000)}]};
    throw Error('unexpected write');
   }} as never);
  }catch(error){statements.push('ROLLBACK');throw error;}
 };
 assert.equal(await issueReplayProtectedAdminSession(transaction,verified,pepper,now),null);
 assert.deepEqual(statements,['lockout','ROLLBACK']);
});
