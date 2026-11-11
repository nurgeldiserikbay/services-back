import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Client} from 'pg';
import {PlatformModerationReadService} from '../src/modules/admin/admin-moderation-read.service.js';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {DatabasePool} from '../src/platform/database/database.pool.js';

test('moderation queue only returns redacted cases from currently granted scopes',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 const oldFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 const oldKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 try{
  await db.query('BEGIN');
  const userId=randomUUID(),staffId=randomUUID(),sessionId=randomUUID();
  const granted='organization:'+randomUUID();
  const forbidden='organization:'+randomUUID();
  const visibleId=randomUUID(),hiddenId=randomUUID();
  const pepper=randomBytes(32);
  const {token,hash}=issueAdminSessionToken(pepper);
  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query('INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,$3)',
   [staffId,userId,'auditor']);
  await db.query(`INSERT INTO platform_admin_sessions
   (id,staff_id,token_hash,mfa_verified_at,expires_at)
   VALUES($1,$2,$3,now(),now()+interval '1 hour')`,
   [sessionId,staffId,hash]);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [randomUUID(),staffId,granted]);
  for(const [id,scope] of [[visibleId,granted],[hiddenId,forbidden]]){
   await db.query(`INSERT INTO platform_moderation_cases
    (id,resource_scope,subject_kind,state) VALUES($1,$2,'review','triage')`,
    [id,scope]);
  }
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  // Reuse the already-open transaction so fixture writes remain visible.
  const adapter={transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(db)};
  const service=new PlatformModerationReadService(adapter as unknown as DatabasePool);
  const result=await service.list('Bearer '+token);
  assert.deepEqual(result.items.map(item=>item.id),[visibleId]);
  assert.deepEqual(Object.keys(result.items[0]!).sort(),
   ['createdAt','id','state','subjectKind']);
  await db.query('DELETE FROM platform_admin_grants WHERE staff_id=$1',[staffId]);
  assert.deepEqual(await service.list('Bearer '+token),{items:[]});
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',[sessionId]);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
  if(oldFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=oldFlag;
  if(oldKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=oldKey;
 }
});
