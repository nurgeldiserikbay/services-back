import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {issueAdminSessionInTransaction} from '../src/modules/admin/admin-mfa-transaction.js';

const staffId=randomUUID();
const secret=randomBytes(32);
const pepper=randomBytes(32);
const counter=123456;
const now=counter*30000;
const input=Buffer.alloc(8);
input.writeBigUInt64BE(BigInt(counter));
const digest=createHmac('sha1',secret).update(input).digest();
const offset=digest[digest.length-1]!&15;
const code=String((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,'0');
const primary={staffId,authenticatedAt:now-1000};

function poolFor(mode:'success'|'replay'|'denied'|'commit-failure'|'locked'|'disabled-factor'){
 const events:string[]=[];
 let released=false;
 const client={
  query:async(sql:string)=>{
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){
    events.push(sql);
    if(sql==='COMMIT'&&mode==='commit-failure')throw Error('commit failed');
    return {rows:[]};
   }
   if(sql.includes('INSERT INTO platform_admin_security_events')){
    events.push('audit');
    return {rows:[{id:randomUUID()}]};
   }
   if(sql.includes('pg_advisory_xact_lock')){
    events.push('staff-lock');
    return {rows:[{}]};
   }
   if(sql.includes('FROM platform_admin_mfa_attempts')){
    events.push('lockout-check');
    return {rows:mode==='locked'?[{locked_until:new Date(now+60000)}]:[]};
   }
   if(sql.includes('DELETE FROM platform_admin_mfa_attempts')){
    events.push('clear-failures');
    return {rows:[]};
   }
   if(sql.includes('INSERT INTO platform_admin_mfa_attempts')){
    events.push('record-failure');
    return {rows:[{failed_attempts:1,locked_until:null}]};
   }
   if(sql.includes('FOR SHARE OF factor')){
    events.push('factor-check');
    return {rows:mode==='disabled-factor'?[]:[{staff_id:staffId}]};
   }
   if(sql.includes('platform_admin_totp_replay')){
    events.push('consume');
    return {rows:mode==='replay'?[]:[{last_consumed_counter:String(counter)}]};
   }
   if(sql.includes('INSERT INTO platform_admin_sessions')){
    events.push('issue');
    return {rows:mode==='denied'?[]:[{id:randomUUID()}]};
   }
   throw Error('unexpected SQL');
  },
  release:()=>{released=true;events.push('release');},
 };
 return {pool:{connect:async()=>client} as never,events,
  get released(){return released;}};
}

test('admin session is returned only after successful commit',async()=>{
 const fixture=poolFor('success');
 const result=await issueAdminSessionInTransaction(
  fixture.pool,primary,secret,code,pepper,now,
 );
 assert.ok(result);
 assert.equal(result.token.length,43);
 assert.deepEqual(fixture.events,['BEGIN','staff-lock','lockout-check','factor-check','consume','issue','clear-failures','audit','COMMIT','release']);
 assert.equal(fixture.released,true);
});
test('replayed code rolls back without issuing a session',async()=>{
 const fixture=poolFor('replay');
 assert.equal(await issueAdminSessionInTransaction(
  fixture.pool,primary,secret,code,pepper,now,
 ),null);
 assert.deepEqual(fixture.events,['BEGIN','staff-lock','lockout-check','factor-check','consume','record-failure','audit','COMMIT','release']);
});
test('failed issuance rolls back consumed TOTP watermark',async()=>{
 const fixture=poolFor('denied');
 await assert.rejects(issueAdminSessionInTransaction(
  fixture.pool,primary,secret,code,pepper,now,
 ),/admin_mfa_session_issuance_denied/);
 assert.deepEqual(fixture.events,['BEGIN','staff-lock','lockout-check','factor-check','consume','issue','ROLLBACK','release']);
});
test('failed commit never returns the generated bearer',async()=>{
 const fixture=poolFor('commit-failure');
 await assert.rejects(issueAdminSessionInTransaction(
  fixture.pool,primary,secret,code,pepper,now,
 ),/commit failed/);
 assert.deepEqual(fixture.events,['BEGIN','staff-lock','lockout-check','factor-check','consume','issue','clear-failures','audit','COMMIT','ROLLBACK','release']);
});

test('locked MFA account never verifies or issues a privileged session',async()=>{
 const fixture=poolFor('locked');
 assert.equal(await issueAdminSessionInTransaction(
  fixture.pool,primary,secret,code,pepper,now,
 ),null);
 assert.deepEqual(fixture.events,['BEGIN','staff-lock','lockout-check','ROLLBACK','release']);
});

test('disabled MFA factor cannot issue a session through raw-secret path',async()=>{
 const fixture=poolFor('disabled-factor');
 assert.equal(await issueAdminSessionInTransaction(
  fixture.pool,primary,secret,code,pepper,now,
 ),null);
 assert.deepEqual(fixture.events,[
  'BEGIN','staff-lock','lockout-check','factor-check','ROLLBACK','release',
 ]);
});

test('malformed primary assertion is denied before database connection',async()=>{
 let connects=0;
 const pool={connect:async()=>{connects++;throw Error('unexpected connection');}} as never;
 assert.equal(await issueAdminSessionInTransaction(
  pool,{staffId:'bad',authenticatedAt:now},secret,code,pepper,now,
 ),null);
 assert.equal(connects,0);
});
