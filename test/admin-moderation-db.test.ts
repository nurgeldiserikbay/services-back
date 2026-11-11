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
  const {token,tokenHash:hash}=issueAdminSessionToken(pepper);
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
  // Configuration must fail closed even when the token and DB grant are valid.
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='disabled';
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  await assert.rejects(service.list('Basic '+token),{name:'UnauthorizedException'});
  const result=await service.list('Bearer '+token);
  assert.deepEqual(result.items.map(item=>item.id),[visibleId]);
  assert.deepEqual(Object.keys(result.items[0]!).sort(),
   ['createdAt','id','state','subjectKind']);
  await assert.rejects(service.list('Bearer '+issueAdminSessionToken(pepper).token),
   {name:'UnauthorizedException'});
  await db.query('UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval \'16 minutes\' WHERE id=$1',
   [sessionId]);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  await db.query('UPDATE platform_admin_sessions SET mfa_verified_at=now() WHERE id=$1',
   [sessionId]);
  await db.query('UPDATE platform_admin_staff SET disabled_at=now() WHERE id=$1',[staffId]);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  await db.query('UPDATE platform_admin_staff SET disabled_at=NULL WHERE id=$1',[staffId]);
  assert.deepEqual((await service.list('Bearer '+token)).items.map(item=>item.id),[visibleId]);
  // A new explicit grant makes the second resource visible; removing it must
  // immediately hide that resource without revoking the first grant.
  const extraGrant=randomUUID();
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [extraGrant,staffId,forbidden]);
  const both=(await service.list('Bearer '+token)).items.map(item=>item.id);
  assert.deepEqual(new Set(both),new Set([visibleId,hiddenId]));
  await db.query('DELETE FROM platform_admin_grants WHERE id=$1',[extraGrant]);
  assert.deepEqual((await service.list('Bearer '+token)).items.map(item=>item.id),[visibleId]);
  // Queue pagination boundary: only the newest 50 scoped cases are returned.
  const additionalIds:string[]=[];
  for(let i=0;i<55;i++){
   const id=randomUUID();
   additionalIds.push(id);
   await db.query(`INSERT INTO platform_moderation_cases
    (id,resource_scope,subject_kind,state,created_at)
    VALUES($1,$2,'review','triage',$3)`,
    [id,granted,new Date(Date.now()+i*1000)]);
  }
  const limited=await service.list('Bearer '+token);
  assert.equal(limited.items.length,50);
  assert.deepEqual(limited.items.map(item=>item.id),additionalIds.slice(-50).reverse());
  await db.query('DELETE FROM platform_admin_grants WHERE staff_id=$1',[staffId]);
  assert.deepEqual(await service.list('Bearer '+token),{items:[]});
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',[sessionId]);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  await db.query('UPDATE platform_admin_sessions SET revoked_at=NULL WHERE id=$1',[sessionId]);
  await db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[userId]);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  await db.query("UPDATE users SET status='ACTIVE' WHERE id=$1",[userId]);
  await db.query('UPDATE platform_admin_sessions SET expires_at=now()-interval \'1 second\' WHERE id=$1',
   [sessionId]);
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
