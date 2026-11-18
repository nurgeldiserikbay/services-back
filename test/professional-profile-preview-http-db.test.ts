import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {AccountProfessionalProfilesController} from '../src/modules/identity/account-professional-profiles.controller.js';
import {AccountBearerSessionService} from '../src/modules/identity/account-bearer-session.service.js';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {DatabasePool} from '../src/platform/database/database.pool.js';

test('live profile preview enforces owner and retains published snapshot after edit',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 const pepper=randomBytes(32);
 const owner=randomUUID(),other=randomUUID(),person=randomUUID(),foreignPerson=randomUUID();
 const own=issueSessionToken(pepper),foreign=issueSessionToken(pepper),expired=issueSessionToken(pepper);
 const old=process.env.ACCOUNT_SESSION_HMAC_KEY;
 const oldPreview=process.env.SERVICES_ENABLE_PROFILE_PREVIEW;
 process.env.ACCOUNT_SESSION_HMAC_KEY=pepper.toString('base64');
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 try{
  await db.connect();await db.query('BEGIN');
  await db.query('INSERT INTO users(id) VALUES($1),($2)',[owner,other]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2),($3,$4)',[person,owner,foreignPerson,other]);
  const profession=randomUUID(),ownProfile=randomUUID(),foreignProfile=randomUUID();
  await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await db.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status) VALUES($1,$2,$3,$4,'DRAFT'),($5,$6,$3,$7,'PAUSED')",[ownProfile,person,profession,ownProfile,foreignProfile,foreignPerson,foreignProfile]);
  const sessionId=randomUUID();
  await db.query(`
   INSERT INTO sessions(id,user_id,token_hash,family_id,expires_at)
   VALUES($1,$2,$3,$4,now()+interval '1 day'),
         ($5,$6,$7,$8,now()+interval '1 day'),
         ($9,$2,$10,$11,now()-interval '1 second')
  `,[sessionId,owner,own.hash,randomUUID(),randomUUID(),other,foreign.hash,randomUUID(),randomUUID(),expired.hash,randomUUID()]);
  const pool={transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(db)};
  @Module({controllers:[AccountProfessionalProfilesController],providers:[AccountBearerSessionService,{provide:DatabasePool,useValue:pool}]})
  class FixtureModule{}
  app=await NestFactory.create(FixtureModule,{logger:false,abortOnError:false});
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const url=(await app.getUrl())+'/v1/me/professional-profiles';
  const request=(token?:string)=>fetch(url,{headers:token?{Authorization:'Bearer '+token}:{Cookie:'session='+own.token}});
  assert.equal((await request()).status,401);
  assert.equal((await request('invalid')).status,401);
  assert.equal((await request(expired.token)).status,401);
  const first=await request(own.token);
  assert.equal(first.status,200);
  assert.match(first.headers.get('cache-control')??'',/no-store/);
  assert.equal(first.headers.get('pragma'),'no-cache');
  assert.deepEqual(await first.json(),[{id:ownProfile,profession_id:profession,lifecycle_status:'draft',slug:ownProfile,title:null,version:1,about:null,offers:[]}]);
  const second=await request(foreign.token);
  assert.equal(second.status,200);
  assert.deepEqual(await second.json(),[{id:foreignProfile,profession_id:profession,lifecycle_status:'paused',slug:foreignProfile,title:null,version:1,about:null,offers:[]}]);
  const preview=(token:string,id:string)=>fetch(url+'/'+id+'/preview',{headers:{Authorization:'Bearer '+token}});
  assert.equal((await preview(own.token,ownProfile)).status,404);
  process.env.SERVICES_ENABLE_PROFILE_PREVIEW='enabled';
  assert.equal((await preview(own.token,foreignProfile)).status,404);
  assert.equal((await preview(foreign.token,ownProfile)).status,404);
  assert.equal((await preview(own.token,'bad')).status,400);
  assert.equal((await preview('invalid',ownProfile)).status,401);
  const before=await preview(own.token,ownProfile);
  assert.equal(before.status,200);
  assert.match(before.headers.get('cache-control')??'',/no-store/);
  assert.deepEqual(await before.json(),{
   id:ownProfile,slug:ownProfile,profession_id:profession,lifecycle_status:'draft',
   draft:{title:null,about:null,version:1},published:null,
  });
  await db.query("UPDATE professional_profiles SET title='First public',status='PUBLISHED' WHERE id=$1",[ownProfile]);
  const firstPublic=await preview(own.token,ownProfile);
  assert.deepEqual((await firstPublic.json()).published,{title:'First public',about:null,version:1});
  const update=(token:string,id:string,version:string,body:unknown)=>fetch(url+'/'+id,{
   method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','If-Match':version},
   body:JSON.stringify(body),
  });
  assert.equal((await update(foreign.token,ownProfile,'"1"',{title:'foreign'})).status,403);
  assert.equal((await update(own.token,ownProfile,'W/"1"',{title:'weak'})).status,400);
  const edited=await update(own.token,ownProfile,'"1"',{title:'My profession',about:'Қызмет сипаттамасы'});
  assert.equal(edited.status,200);
  assert.deepEqual(await edited.json(),{id:ownProfile,profession_id:profession,lifecycle_status:'published',slug:ownProfile,title:'My profession',about:'Қызмет сипаттамасы',version:2,offers:[]});
  assert.equal((await update(own.token,ownProfile,'"1"',{title:'stale'})).status,409);
  const editedPreview=await preview(own.token,ownProfile);
  assert.deepEqual(await editedPreview.json(),{
   id:ownProfile,slug:ownProfile,profession_id:profession,lifecycle_status:'published',
   draft:{title:'My profession',about:'Қызмет сипаттамасы',version:2},
   published:{title:'First public',about:null,version:1},
  });
  const after=await request(own.token);
  assert.deepEqual(await after.json(),[{id:ownProfile,profession_id:profession,lifecycle_status:'draft',slug:ownProfile,title:'My profession',about:'Қызмет сипаттамасы',version:2,offers:[]}]);
  await db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[sessionId]);
  assert.equal((await update(own.token,ownProfile,'"2"',{title:'revoked'})).status,401);
  assert.equal((await preview(own.token,ownProfile)).status,401);
  assert.equal((await request(own.token)).status,401);
  assert.equal((await request(foreign.token)).status,200);
  await db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[other]);
  assert.equal((await request(foreign.token)).status,401);
 }finally{
  try{await app?.close();}finally{
   if(oldPreview===undefined)delete process.env.SERVICES_ENABLE_PROFILE_PREVIEW;
   else process.env.SERVICES_ENABLE_PROFILE_PREVIEW=oldPreview;
   if(old===undefined)delete process.env.ACCOUNT_SESSION_HMAC_KEY;
   else process.env.ACCOUNT_SESSION_HMAC_KEY=old;
   await db.query('ROLLBACK').catch(()=>{});await db.end();
  }
 }
});
