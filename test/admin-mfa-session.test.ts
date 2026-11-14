import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {issueAdminSessionAfterTotp} from '../src/modules/admin/admin-mfa-session.js';

const staffId=randomUUID();
const secret=randomBytes(32);
const pepper=randomBytes(32);
const counter=123456;
const now=counter*30000;
function codeAt(step:number):string{
 const input=Buffer.alloc(8);
 input.writeBigUInt64BE(BigInt(step));
 const digest=createHmac('sha1',secret).update(input).digest();
 const offset=digest[digest.length-1]!&15;
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,'0');
}
const primary={staffId,authenticatedAt:now-1000};

test('MFA orchestration consumes replay counter before issuing a session',async()=>{
 const queries:string[]=[];
 const db={query:async(sql:string,params:unknown[])=>{
  queries.push(sql);
  if(sql.includes('platform_admin_totp_replay')){
   assert.deepEqual(params,[staffId,counter]);
   return {rows:[{last_consumed_counter:String(counter)}]};
  }
  assert.match(sql,/INSERT INTO platform_admin_sessions/);
  return {rows:[{id:randomUUID()}]};
 }} as never;
 const result=await issueAdminSessionAfterTotp(
  db,primary,secret,codeAt(counter),pepper,now,
 );
 assert.ok(result);
 assert.equal(result.token.length,43);
 assert.equal(result.expiresAt,now+900000);
 assert.equal(queries.length,2);
 assert.match(queries[0]!,/platform_admin_totp_replay/);
 assert.match(queries[1]!,/platform_admin_sessions/);
});

test('replayed code never reaches session issuance',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;return {rows:[]};}} as never;
 assert.equal(await issueAdminSessionAfterTotp(
  db,primary,secret,codeAt(counter),pepper,now,
 ),null);
 assert.equal(queries,1);
});

test('invalid or stale primary assertion and invalid TOTP never touch SQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;return {rows:[]};}} as never;
 for(const [assertion,code] of [
  [{...primary,authenticatedAt:now-300001},codeAt(counter)],
  [{...primary,authenticatedAt:now+1},codeAt(counter)],
  [{...primary,authenticatedAt:now,untrusted:true},codeAt(counter)],
  [primary,'invalid'],
 ] as const){
  assert.equal(await issueAdminSessionAfterTotp(
   db,assertion as never,secret,code,pepper,now,
  ),null);
 }
 assert.equal(queries,0);
});

test('session denial after consuming MFA throws so transaction owner rolls back',async()=>{
 const db={query:async(sql:string)=>{
  if(sql.includes('platform_admin_totp_replay'))
   return {rows:[{last_consumed_counter:String(counter)}]};
  return {rows:[]};
 }} as never;
 await assert.rejects(issueAdminSessionAfterTotp(
  db,primary,secret,codeAt(counter),pepper,now,
 ),/admin_mfa_session_issuance_denied/);
});

test('out-of-range MFA session expiry is rejected before replay SQL',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;throw Error('unexpected SQL');}} as never;
 const invalidNow=8_640_000_000_000_000-15*60*1000+1;
 assert.equal(await issueAdminSessionAfterTotp(
  db,{staffId,authenticatedAt:invalidNow-1000},
  secret,codeAt(counter),pepper,invalidNow,
 ),null);
 assert.equal(queries,0);
});
