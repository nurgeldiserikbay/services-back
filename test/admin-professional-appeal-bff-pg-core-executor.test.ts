import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {UnauthorizedException} from '@nestjs/common';
import {issueAdminSessionToken,hashAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {assertAppealBffPgParentBearer,executeAppealBffPgCoreMutation} from '../src/modules/admin/admin-professional-appeal-bff-pg-core-executor.js';

test('real PostgreSQL binds browser BFF proof to exactly the issuing privileged bearer',{
 skip:!process.env.DATABASE_URL,
},async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  await db.query(`CREATE TEMP TABLE platform_admin_sessions(
   id uuid PRIMARY KEY,staff_id uuid NOT NULL,token_hash char(64) UNIQUE NOT NULL,
   revoked_at timestamptz,expires_at timestamptz NOT NULL)`);
  await db.query(`CREATE TEMP TABLE platform_admin_appeal_browser_sessions(
   id uuid PRIMARY KEY,staff_id uuid NOT NULL,admin_session_id uuid NOT NULL,
   revoked_at timestamptz,expires_at timestamptz NOT NULL)`);
  const staff=randomUUID(),parentId=randomUUID(),otherId=randomUUID(),browserId=randomUUID();
  const pepper=randomBytes(32),issued=issueAdminSessionToken(pepper);
  const unrelated=issueAdminSessionToken(pepper);
  await db.query(`INSERT INTO platform_admin_sessions(id,staff_id,token_hash,expires_at)
   VALUES($1,$2,$3,now()+interval '20 minutes'),
     ($4,$2,$5,now()+interval '20 minutes')`,
   [parentId,staff,issued.tokenHash,otherId,unrelated.tokenHash]);
  await db.query(`INSERT INTO platform_admin_appeal_browser_sessions
   (id,staff_id,admin_session_id,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')`,
   [browserId,staff,parentId]);
  await db.query('BEGIN');
  await assertAppealBffPgParentBearer(db,browserId,issued.token,pepper);
  await db.query('COMMIT');
  await assert.rejects(assertAppealBffPgParentBearer(db,browserId,unrelated.token,pepper),
   UnauthorizedException,'different still-valid session for the same staff must deny');
  await assert.rejects(assertAppealBffPgParentBearer(db,browserId,'forged',pepper),
   UnauthorizedException);
  await assert.rejects(assertAppealBffPgParentBearer(db,'bad',issued.token,pepper),
   UnauthorizedException);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',[parentId]);
  await assert.rejects(assertAppealBffPgParentBearer(db,browserId,issued.token,pepper),
   UnauthorizedException,'revoked parent invalidates BFF bearer association');
  await db.query('UPDATE platform_admin_sessions SET revoked_at=NULL WHERE id=$1',[parentId]);
  await db.query('UPDATE platform_admin_appeal_browser_sessions SET revoked_at=now() WHERE id=$1',[browserId]);
  await assert.rejects(assertAppealBffPgParentBearer(db,browserId,issued.token,pepper),
   UnauthorizedException,'revoked child invalidates BFF bearer association');
 }finally{await db.end();}
});

test('parent bearer validation uses only hash and denies malformed inputs before SQL',async()=>{
 let calls=0;
 const pepper=randomBytes(32),issued=issueAdminSessionToken(pepper);
 const fake={query:async(sql:string,params:unknown[])=>{
  calls++;
  assert.match(sql,/parent\.token_hash=\$2/);
  assert.match(sql,/parent\.id=browser\.admin_session_id/);
  assert.match(sql,/FOR SHARE OF browser,parent/);
  assert.equal(params[1],hashAdminSessionToken(issued.token,pepper));
  assert.ok(!JSON.stringify(params).includes(issued.token));
  return {rows:[]};
 }};
 await assert.rejects(assertAppealBffPgParentBearer(fake as never,randomUUID(),issued.token,pepper),
  UnauthorizedException);
 assert.equal(calls,1);
 for(const args of [
  ['bad',issued.token,pepper],
  [randomUUID(),'bad',pepper],
  [randomUUID(),issued.token,Buffer.alloc(0)],
 ] as const){
  await assert.rejects(assertAppealBffPgParentBearer(fake as never,args[0],args[1],args[2]),
   UnauthorizedException);
 }
 assert.equal(calls,1);
});

test('BFF appeal executor denies invalid action without opening a transaction',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;throw Error('unexpected query');}};
 await assert.rejects(executeAppealBffPgCoreMutation(db as never,randomUUID(),randomUUID(),
  'export' as never,'invalid',randomBytes(32),{}),UnauthorizedException);
 assert.equal(calls,0);
});
