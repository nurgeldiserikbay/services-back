import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {AppModule} from '../src/modules/app.module.js';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';

/**
 * Exercises Nest HTTP + real PostgreSQL session/grant/case queries together.
 * All fixtures live inside a transaction rolled back after the test.
 * Production admin rollout stays disabled; the flag is process-local to CI.
 */
test('moderation HTTP enforces persisted admin grants MFA and revocation',async()=>{
 const originalFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 const originalPepper=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 const db=new Client({connectionString:process.env.DATABASE_URL});
 const pepper=randomBytes(32);
 const {token,tokenHash}=issueAdminSessionToken(pepper);
 let app:INestApplication|undefined;
 let transactionStarted=false;
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  await db.connect();
  await db.query('BEGIN');
  transactionStarted=true;
  const userId=randomUUID(),staffId=randomUUID(),sessionId=randomUUID();
  const allowedId=randomUUID(),deniedId=randomUUID(),grantId=randomUUID();
  const allowedScope='organization:'+randomUUID();
  const deniedScope='organization:'+randomUUID();

  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'auditor')",[staffId,userId]);
  await db.query(`
   INSERT INTO platform_admin_sessions(id,staff_id,token_hash,mfa_verified_at,expires_at)
   VALUES($1,$2,$3,now()-interval '1 second',now()+interval '1 hour')
  `,[sessionId,staffId,tokenHash]);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',[grantId,staffId,allowedScope]);
  await db.query(`
   INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state)
   VALUES($1,$2,'organization','triage'),($3,$4,'review','decision')
  `,[allowedId,allowedScope,deniedId,deniedScope]);

  // An admin bearer is valid only with an activated, non-disabled TOTP factor.
  await db.query(`
   INSERT INTO platform_admin_totp_factors(
    staff_id,encrypted_secret,key_version,created_at,activated_at
   ) VALUES($1,$2,$3,now()-interval '4 minutes',now()-interval '3 minutes')
  `,[staffId,'integration-test-placeholder-encrypted-envelope','test-v1']);
  app=await NestFactory.create(AppModule,{logger:false});
  // Route all app queries through the same rollback-only transaction so the
  // endpoint sees fixtures without publishing privileged data to other tests.
  app.get(DatabasePool).transaction=async <T>(work:(client:PoolClient)=>Promise<T>):Promise<T>=>
   work(db as unknown as PoolClient);
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const address=app.getHttpServer().address();
  assert.ok(address&&typeof address!=='string');
  const url=`http://127.0.0.1:${address.port}/v1/admin/moderation/cases`;
  const get=(proof?:string)=>fetch(url,{
   headers:proof?{Authorization:'Bearer '+proof}:{},
   redirect:'manual',
  });

  const allowed=await get(token);
  assert.equal(allowed.status,200);
  assert.match(allowed.headers.get('cache-control')??'',/no-store/);
  assert.match(allowed.headers.get('x-robots-tag')??'',/noindex/);
  const payload=await allowed.json() as {items:Array<Record<string,unknown>>};
  assert.equal(payload.items.length,1);
  assert.deepEqual(Object.keys(payload.items[0]).sort(),['createdAt','id','state','subjectKind']);
  assert.equal(payload.items[0].id,allowedId);
  assert.ok(!JSON.stringify(payload).includes(deniedId));
  assert.ok(!JSON.stringify(payload).includes(token));

  const anonymous=await get();
  assert.equal(anonymous.status,401);
  const wrong=await get(randomBytes(32).toString('base64url'));
  assert.equal(wrong.status,401);

  await db.query("UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '20 minutes' WHERE id=$1",[sessionId]);
  const stale=await get(token);
  assert.equal(stale.status,401);

  await db.query('UPDATE platform_admin_sessions SET mfa_verified_at=now(),revoked_at=now() WHERE id=$1',[sessionId]);
  const revoked=await get(token);
  assert.equal(revoked.status,401);
  assert.ok(!(await revoked.text()).includes(token));
 }finally{
  if(app)await app.close();
  if(transactionStarted)await db.query('ROLLBACK').catch(()=>{});
  await db.end().catch(()=>{});
  if(originalFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=originalFlag;
  if(originalPepper===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=originalPepper;
 }
});
