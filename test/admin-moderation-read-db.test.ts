import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {UnauthorizedException} from '@nestjs/common';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {PlatformModerationReadService} from '../src/modules/admin/admin-moderation-read.service.js';
import {resolvePlatformAdminSession} from '../src/modules/admin/admin-session-resolver.js';

test('moderation read endpoint stays disabled without approved rollout',async()=>{
 const current=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 try{
  const service=new PlatformModerationReadService({transaction:async()=>{throw Error('unexpected DB');}} as never);
  await assert.rejects(service.list('Bearer '+randomBytes(32).toString('base64url')),UnauthorizedException);
 }finally{
  if(current===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=current;
 }
});

test('privileged read returns only redacted cases in live authorized scopes',async()=>{
 const previousFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 const previousPepper=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 const key=randomBytes(32),db=new Client({connectionString:process.env.DATABASE_URL});
 process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
 process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=key.toString('base64');
 await db.connect();
 await db.query('BEGIN');
 try{
  const userId=randomUUID(),staffId=randomUUID(),sessionId=randomUUID();
  const grantId=randomUUID(),allowedId=randomUUID(),deniedId=randomUUID();
  const allowedScope='organization:'+randomUUID();
  const deniedScope='organization:'+randomUUID();
  const {token,tokenHash}=issueAdminSessionToken(key);
  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'auditor')",[staffId,userId]);
  await db.query(`
    INSERT INTO platform_admin_sessions(id,staff_id,token_hash,mfa_verified_at,expires_at)
    VALUES($1,$2,$3,now(),now()+interval '1 hour')
  `,[sessionId,staffId,tokenHash]);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',[grantId,staffId,allowedScope]);
  await db.query(`
    INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state)
    VALUES($1,$2,'organization','triage'),($3,$4,'review','decision')
  `,[allowedId,allowedScope,deniedId,deniedScope]);
  const service=new PlatformModerationReadService({
   transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(db),
  } as never);
  // Isolate the PostgreSQL auth lookup from the subsequent moderation query.
  // These assertions expose the failing boundary without logging bearer secrets.
  const principal=await resolvePlatformAdminSession(db,token,key);
  assert.ok(principal,'PostgreSQL admin session lookup must return a principal');
  assert.deepEqual(principal.resourceScopes,[allowedScope]);
  const scoped=await db.query<{id:string}>(`
    SELECT moderation.id::text AS id FROM platform_moderation_cases AS moderation
    WHERE moderation.resource_scope=ANY($1::varchar[])
      AND EXISTS (
        SELECT 1 FROM platform_admin_grants AS current_grant
        JOIN platform_admin_staff AS current_staff ON current_staff.id=current_grant.staff_id
        JOIN platform_admin_sessions AS current_session ON current_session.staff_id=current_staff.id
        JOIN users AS account_row ON account_row.id=current_staff.user_id
        WHERE current_staff.user_id=$2::uuid AND current_staff.disabled_at IS NULL
          AND account_row.status='ACTIVE' AND current_session.token_hash=$3
          AND current_session.revoked_at IS NULL
          AND current_session.expires_at>to_timestamp($4::double precision/1000.0)
          AND current_session.mfa_verified_at<=to_timestamp($4::double precision/1000.0)
          AND current_session.mfa_verified_at>=to_timestamp(($4::double precision-900000)/1000.0)
          AND current_grant.scope=moderation.resource_scope
      )
  `,[[allowedScope],userId,tokenHash,Date.now()]);
  assert.deepEqual(scoped.rows.map(row=>row.id),[allowedId],
    'PostgreSQL live grant gate must return only the allowed case');
  const response=await service.list('Bearer '+token);
  assert.deepEqual(Object.keys(response),['items']);
  assert.equal(response.items.length,1);
  assert.deepEqual(Object.keys(response.items[0]).sort(),
   ['createdAt','id','state','subjectKind']);
  assert.equal(response.items[0].id,allowedId);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',[sessionId]);
  await assert.rejects(service.list('Bearer '+token),UnauthorizedException);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
  if(previousFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=previousFlag;
  if(previousPepper===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=previousPepper;
 }
});
