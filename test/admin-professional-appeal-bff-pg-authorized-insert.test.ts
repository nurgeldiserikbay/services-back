import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {Client} from 'pg';
import {issueAdminSessionToken,hashAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {createAppealBffPgAuthorizedSessionInsert} from '../src/modules/admin/admin-professional-appeal-bff-pg-authorized-insert.js';

const start=Date.UTC(2026,10,19,8);
const scope='professional:'+randomUUID();
const adminPepper=randomBytes(32);
const adminBearer=issueAdminSessionToken(adminPepper).token;
const context={adminBearer,adminPepper,resourceScope:scope,now:start};
const hash=randomBytes(32).toString('hex');

test('prepared PostgreSQL issuance binds hash-only INSERT to session MFA, staff and grant',async()=>{
 let calls=0;
 const db={query:async(sql:string,params:unknown[])=>{
  calls++;
  assert.match(sql,/INSERT INTO platform_admin_appeal_browser_sessions/);
  assert.match(sql,/auth.revoked_at IS NULL/);
  assert.match(sql,/FOR SHARE OF auth\s+RETURNING/i,
   'lock authorizing admin session through the INSERT statement');
  assert.match(sql,/auth.expires_at>=to_timestamp/);
  assert.match(sql,/auth.mfa_verified_at>=to_timestamp/);
  assert.match(sql,/staff.disabled_at IS NULL/);
  assert.match(sql,/usr.status='ACTIVE'/);
  assert.match(sql,/platform_admin_totp_factors/);
  assert.match(sql,/platform_admin_grants/);
  assert.match(sql,/scoped_grant.scope=\$5/);
  assert.deepEqual(params.slice(1),[hash,start+60_000,
   hashAdminSessionToken(adminBearer,adminPepper),scope,start]);
  assert.ok(!JSON.stringify(params).includes(adminBearer),'never send plaintext bearer');
  return {rows:[{id:params[0]}]};
 }} as unknown as Pick<PoolClient,'query'>;
 const persist=createAppealBffPgAuthorizedSessionInsert(db,context);
 assert.equal(await persist(hash,start+60_000),true);
 assert.equal(calls,1);
});

test('invalid BFF proof and authorization prerequisites deny before PostgreSQL',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;return {rows:[]};}} as unknown as Pick<PoolClient,'query'>;
 const bad=[
  {hash:'bad',expiresAt:start+60_000,c:context},
  {hash,expiresAt:start,c:context},{hash,expiresAt:start+3_600_001,c:context},
  {hash,expiresAt:NaN,c:context},
  {hash,expiresAt:start+60_000,c:{...context,resourceScope:'unknown'}},
  {hash,expiresAt:start+60_000,c:{...context,adminBearer:'bad'}},
  {hash,expiresAt:start+60_000,c:{...context,adminPepper:randomBytes(16)}},
  {hash,expiresAt:start+60_000,c:{...context,now:NaN}},
 ];
 for(const item of bad){
  const insert=createAppealBffPgAuthorizedSessionInsert(db,item.c);
  assert.equal(await insert(item.hash,item.expiresAt),false);
 }
 assert.equal(calls,0);
});

test('storage ambiguity and outages never report committed authorized issuance',async()=>{
 for(const rows of [[],[{id:randomUUID()}],[{id:randomUUID()},{id:randomUUID()}]]){
  const db={query:async()=>({rows})} as unknown as Pick<PoolClient,'query'>;
  assert.equal(await createAppealBffPgAuthorizedSessionInsert(db,context)(
   hash,start+60_000),false);
 }
 const fail={query:async()=>{throw new Error('postgres unavailable');}} as unknown as Pick<PoolClient,'query'>;
 await assert.rejects(createAppealBffPgAuthorizedSessionInsert(fail,context)(
  hash,start+60_000),/postgres unavailable/);
});

test('real migrated PostgreSQL denies issuance without live admin session',{
 skip:!process.env.DATABASE_URL,
},async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  const persist=createAppealBffPgAuthorizedSessionInsert(db,context);
  assert.equal(await persist(hash,start+60_000),false);
  const row=await db.query('SELECT id FROM platform_admin_appeal_browser_sessions WHERE token_hash=$1',[hash]);
  assert.equal(row.rows.length,0);
 }finally{await db.end();}
});
