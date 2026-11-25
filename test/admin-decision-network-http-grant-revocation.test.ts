import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {PlatformProfessionalDecisionController}
 from '../src/modules/admin/admin-professional-decision.controller.js';
import {PlatformProfessionalDecisionService}
 from '../src/modules/admin/admin-professional-decision.service.js';
import {issueAdminSessionToken}
 from '../src/modules/admin/admin-session-token.js';

test('real HTTP admin decision stops after grant removal and never records unauthorized approval',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const prior={
  flag:process.env.SERVICES_ENABLE_PLATFORM_MODERATION_DECIDE_HTTP,
  key:process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY,
 };
 const pepper=randomBytes(32),sessionToken=issueAdminSessionToken(pepper);
 const user=randomUUID(),person=randomUUID(),staff=randomUUID(),session=randomUUID();
 const profession=randomUUID(),profile=randomUUID(),case1=randomUUID(),case2=randomUUID();
 const grant=randomUUID(),scope='professional:'+profile;
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 try{
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',
   [profession,profession]);
  await db.query(`INSERT INTO professional_profiles(id,person_id,profession_id,slug,status)
   VALUES($1,$2,$3,$4,'DRAFT')`,[profile,person,profession,profile]);
  await db.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'operator')",
   [staff,user]);
  await db.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [grant,staff,scope]);
  await db.query(`INSERT INTO platform_admin_sessions
   (id,staff_id,token_hash,mfa_verified_at,expires_at)
   VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour')`,
   [session,staff,sessionToken.tokenHash]);
  await db.query(`INSERT INTO platform_admin_totp_factors
   (staff_id,encrypted_secret,key_version,created_at,activated_at)
   VALUES($1,'integration-test-placeholder-encrypted-envelope',
    'test-v1',now()-interval '4 minutes',now()-interval '3 minutes')`,[staff]);
  for(const caseId of [case1,case2]){
   await db.query(`INSERT INTO platform_moderation_cases
    (id,resource_scope,subject_kind,state)
    VALUES($1,$2,'professional','decision')`,[caseId,scope]);
  }
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_DECIDE_HTTP='enabled';
  @Module({
   controllers:[PlatformProfessionalDecisionController],
   providers:[
    PlatformProfessionalDecisionService,
    {provide:DatabasePool,useValue:{
     transaction:async<T>(work:(client:Client)=>Promise<T>):Promise<T>=>work(db),
    }},
   ],
  })
  class TestModule{}
  app=await NestFactory.create(TestModule,{logger:false});
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const root=await app.getUrl();
  const body={profile_id:profile,profile_version:1,decision:'APPROVE'};
  const post=(caseId:string,headers:Record<string,string>={})=>fetch(
   root+'/v1/admin/moderation/cases/'+caseId+'/decision',{
    method:'POST',redirect:'manual',headers:{
     'Content-Type':'application/json',
     Authorization:'Bearer '+sessionToken.token,...headers,
    },body:JSON.stringify(body),
   });
  const noOrigin=await post(case1,{Origin:'https://untrusted.example'});
  assert.equal(noOrigin.status,401);
  assert.equal((await db.query<{n:number}>(`
   SELECT count(*)::int AS n FROM professional_moderation_decisions
   WHERE case_id=$1`,[case1])).rows[0].n,0);
  const allowed=await post(case1);
  assert.equal(allowed.status,200);
  assert.match(allowed.headers.get('cache-control')??'',/no-store/);
  assert.equal(allowed.headers.get('set-cookie'),null);
  assert.deepEqual(await allowed.json(),{
   case_id:case1,profile_id:profile,profile_version:1,decision:'APPROVE',
  });
  await db.query('DELETE FROM platform_admin_grants WHERE id=$1',[grant]);
  const denied=await post(case2);
  assert.equal(denied.status,401);
  assert.ok(!(await denied.text()).includes(sessionToken.token));
  assert.equal((await db.query<{n:number}>(`
   SELECT count(*)::int AS n FROM professional_moderation_decisions
   WHERE case_id=$1`,[case2])).rows[0].n,0);
  assert.equal((await db.query<{state:string}>(`
   SELECT state FROM platform_moderation_cases WHERE id=$1`,[case2]))
   .rows[0].state,'decision');
  // An identical prior successful decision must not be replayable once
  // the operator loses authority.
  assert.equal((await post(case1)).status,401);
  assert.equal((await db.query<{n:number}>(`
   SELECT count(*)::int AS n FROM professional_moderation_decisions
   WHERE case_id=$1`,[case1])).rows[0].n,1);
 }finally{
  if(app)await app.close();
  if(prior.flag===undefined)
   delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_DECIDE_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_DECIDE_HTTP=prior.flag;
  if(prior.key===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=prior.key;
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
