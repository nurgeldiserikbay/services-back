import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {resolveRecentAdminPrimaryAccountProof} from '../src/modules/admin/admin-primary-account-proof.js';

test('PostgreSQL admin primary proof requires recent live account login and staff mapping',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  await db.query('BEGIN');
  const userId=randomUUID(),staffId=randomUUID(),sessionId=randomUUID();
  const grantId=randomUUID(),scope='organization:'+randomUUID();
  const pepper=randomBytes(32),proof=issueSessionToken(pepper);
  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query(
   "INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'auditor')",
   [staffId,userId]);
  await db.query(
   'INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [grantId,staffId,scope]);
  await db.query(`
   INSERT INTO sessions(id,user_id,token_hash,family_id,expires_at)
   VALUES($1,$2,$3,$4,now()+interval '12 hours')
  `,[sessionId,userId,proof.hash,randomUUID()]);
  const verify=()=>resolveRecentAdminPrimaryAccountProof(db,proof.token,pepper);
  assert.equal((await verify())?.staffId,staffId);
  await db.query(
   "UPDATE sessions SET created_at=now()-interval '6 minutes' WHERE id=$1",
   [sessionId]);
  assert.equal(await verify(),null,'old account session is not recent primary authentication');
  await db.query('UPDATE sessions SET created_at=now() WHERE id=$1',[sessionId]);
  assert.equal((await verify())?.staffId,staffId);
  await db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[sessionId]);
  assert.equal(await verify(),null,'revoked account session must not authenticate admin');
  await db.query('UPDATE sessions SET revoked_at=NULL WHERE id=$1',[sessionId]);
  await db.query('DELETE FROM platform_admin_grants WHERE id=$1',[grantId]);
  assert.equal(await verify(),null,'staff without live grants cannot authenticate admin');
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
