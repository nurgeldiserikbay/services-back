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
   VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour')`,
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
  // Simulate a grant revoked after the session lookup but before the queue
  // SELECT. The SELECT itself must recheck the live grant.
  let revokedDuringRead=false;
  const racingClient=new Proxy(db,{
   get(target,property){
    if(property==='query')return async(sql:string,params:unknown[])=>{
     if(!revokedDuringRead&&sql.includes('FROM platform_moderation_cases AS moderation')){
      revokedDuringRead=true;
      await db.query('DELETE FROM platform_admin_grants WHERE staff_id=$1',[staffId]);
     }
     return db.query(sql,params);
    };
    return Reflect.get(target,property);
   },
  });
  const racingAdapter={transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(racingClient)};
  const racingService=new PlatformModerationReadService(racingAdapter as unknown as DatabasePool);
  assert.deepEqual(await racingService.list('Bearer '+token),{items:[]});
  assert.equal(revokedDuringRead,true);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [randomUUID(),staffId,granted]);
  // Revocation after the first session lookup must still hide every case.
  let revokedDuringQueue=false;
  const revokedClient=new Proxy(db,{
   get(target,property){
    if(property==='query')return async(sql:string,params:unknown[])=>{
     if(!revokedDuringQueue&&sql.includes('FROM platform_moderation_cases AS moderation')){
      revokedDuringQueue=true;
      await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',[sessionId]);
     }
     return db.query(sql,params);
    };
    return Reflect.get(target,property);
   },
  });
  const revokedAdapter={transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(revokedClient)};
  const revokedService=new PlatformModerationReadService(revokedAdapter as unknown as DatabasePool);
  assert.deepEqual(await revokedService.list('Bearer '+token),{items:[]});
  assert.equal(revokedDuringQueue,true);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=NULL WHERE id=$1',[sessionId]);
  // MFA freshness and account state can also change after the initial lookup.
  for(const mutation of [
   "UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '16 minutes' WHERE id=$1",
   "UPDATE users SET status='SUSPENDED' WHERE id=$1",
  ]){
   let mutated=false;
   const mutationClient=new Proxy(db,{
    get(target,property){
     if(property==='query')return async(sql:string,params:unknown[])=>{
      if(!mutated&&sql.includes('FROM platform_moderation_cases AS moderation')){
       mutated=true;
       await db.query(mutation,[mutation.includes('platform_admin_sessions')?sessionId:userId]);
      }
      return db.query(sql,params);
     };
     return Reflect.get(target,property);
    },
   });
   const mutationAdapter={transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(mutationClient)};
   const mutationService=new PlatformModerationReadService(mutationAdapter as unknown as DatabasePool);
   assert.deepEqual(await mutationService.list('Bearer '+token),{items:[]});
   assert.equal(mutated,true);
   if(mutation.includes('platform_admin_sessions'))
    await db.query("UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '1 minute' WHERE id=$1",[sessionId]);
   else await db.query("UPDATE users SET status='ACTIVE' WHERE id=$1",[userId]);
  }
  // A staff suspension between authorization and the SELECT also denies data.
  let disabledDuringQueue=false;
  const disabledClient=new Proxy(db,{
   get(target,property){
    if(property==='query')return async(sql:string,params:unknown[])=>{
     if(!disabledDuringQueue&&sql.includes('FROM platform_moderation_cases AS moderation')){
      disabledDuringQueue=true;
      await db.query('UPDATE platform_admin_staff SET disabled_at=now() WHERE id=$1',[staffId]);
     }
     return db.query(sql,params);
    };
    return Reflect.get(target,property);
   },
  });
  const disabledAdapter={transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(disabledClient)};
  const disabledService=new PlatformModerationReadService(disabledAdapter as unknown as DatabasePool);
  assert.deepEqual(await disabledService.list('Bearer '+token),{items:[]});
  assert.equal(disabledDuringQueue,true);
  await db.query('UPDATE platform_admin_staff SET disabled_at=NULL WHERE id=$1',[staffId]);
  await assert.rejects(service.list('Bearer '+issueAdminSessionToken(pepper).token),
   {name:'UnauthorizedException'});
  await db.query('UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval \'16 minutes\' WHERE id=$1',
   [sessionId]);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  await db.query("UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '1 minute' WHERE id=$1",
   [sessionId]);
  await db.query('UPDATE platform_admin_staff SET disabled_at=now() WHERE id=$1',[staffId]);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  await db.query('UPDATE platform_admin_staff SET disabled_at=NULL WHERE id=$1',[staffId]);
  assert.deepEqual((await service.list('Bearer '+token)).items.map(item=>item.id),[visibleId]);
  // Role changes must be enforced on the same already-issued bearer token.
  await db.query("UPDATE platform_admin_staff SET role='operator' WHERE id=$1",[staffId]);
  assert.deepEqual((await service.list('Bearer '+token)).items.map(item=>item.id),[visibleId]);
  await db.query("UPDATE platform_admin_staff SET role='admin' WHERE id=$1",[staffId]);
  assert.deepEqual((await service.list('Bearer '+token)).items.map(item=>item.id),[visibleId]);
  await db.query("UPDATE platform_admin_staff SET role='auditor' WHERE id=$1",[staffId]);
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
  // The second ordering key must make pagination deterministic on equal timestamps.
  const tiedAt=new Date(Date.now()+120_000);
  const tiedIds=[randomUUID(),randomUUID()].sort();
  for(const id of tiedIds){
   await db.query(`INSERT INTO platform_moderation_cases
    (id,resource_scope,subject_kind,state,created_at)
    VALUES($1,$2,'review','triage',$3)`,[id,granted,tiedAt]);
  }
  const tied=await service.list('Bearer '+token);
  assert.equal(tied.items.length,50);
  assert.deepEqual(tied.items.slice(0,2).map(item=>item.id),tiedIds.reverse());
  await db.query('DELETE FROM platform_admin_grants WHERE staff_id=$1',[staffId]);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1',[sessionId]);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  await db.query('UPDATE platform_admin_sessions SET revoked_at=NULL WHERE id=$1',[sessionId]);
  await db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[userId]);
  await assert.rejects(service.list('Bearer '+token),{name:'UnauthorizedException'});
  await db.query("UPDATE users SET status='ACTIVE' WHERE id=$1",[userId]);
  await db.query("UPDATE platform_admin_sessions SET created_at=now()-interval '2 hours', mfa_verified_at=now()-interval '1 hour', expires_at=now()-interval '1 second' WHERE id=$1",
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
