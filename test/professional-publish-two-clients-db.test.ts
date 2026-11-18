import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import type {PoolClient} from 'pg';
import {ConflictException} from '@nestjs/common';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {publishOwnProfessionalProfile} from '../src/modules/identity/publish-professional-profile.js';

/**
 * Two committed connections, not one shared transactional fixture.
 * Concurrent edit and publish must serialize on the profile row and the
 * losing publication must reject its stale strong ETag without any audit.
 */
test('publication rejects a racing committed edit from another PostgreSQL client',async()=>{
 const a=new Client({connectionString:process.env.DATABASE_URL});
 const b=new Client({connectionString:process.env.DATABASE_URL});
 const pepper=randomBytes(32),proof=issueSessionToken(pepper);
 const user=randomUUID(),person=randomUUID(),profession=randomUUID();
 const service=randomUUID(),offer=randomUUID(),profile=randomUUID(),session=randomUUID();
 let created=false;
 try{
  await Promise.all([a.connect(),b.connect()]);
  await a.query('BEGIN');
  await a.query('INSERT INTO users(id) VALUES($1)',[user]);
  await a.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await a.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await a.query('INSERT INTO service_definitions(id,code,name) VALUES($1,$2,$2)',[service,service]);
  await a.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status,title,about) VALUES($1,$2,$3,$4,'DRAFT','Electrician','Experienced specialist for electrical repairs')",[profile,person,profession,profile]);
  await a.query("INSERT INTO service_offers(id,definition_id,professional_id,title,status,delivery_mode,contacts) VALUES($1,$2,$3,'Repair','PUBLISHED','online','{}'::jsonb)",[offer,service,profile]);
  await a.query("INSERT INTO sessions(id,user_id,token_hash,family_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",
   [session,user,proof.hash,randomUUID()]);
  await a.query('COMMIT');created=true;

  // A claims the row and stages a competing owner edit, not yet committed.
  await a.query('BEGIN');
  await a.query('UPDATE professional_profiles SET version=version+1,title=$2 WHERE id=$1',[profile,'Changed by another editor']);
  await b.query('BEGIN');
  let started!:()=>void;
  const enteringProfileLock=new Promise<void>(resolve=>{started=resolve;});
  const instrumented={query:async(sql:string,params:unknown[])=>{
   if(sql.includes('FROM professional_profiles')&&sql.includes('FOR UPDATE'))started();
   return b.query(sql,params);
  }} as unknown as Pick<PoolClient,'query'>;
  const publication=publishOwnProfessionalProfile(instrumented,proof.token,pepper,profile,'"1"',{});
  // Wait until B has reached its locking statement before A commits.
  await enteringProfileLock;
  await a.query('COMMIT');
  await assert.rejects(publication,ConflictException);
  await b.query('ROLLBACK');
  const check=await a.query('SELECT version,status,published_version FROM professional_profiles WHERE id=$1',[profile]);
  assert.deepEqual(check.rows,[{version:2,status:'DRAFT',published_version:null}]);
  const revision=await a.query('SELECT count(*)::int AS total FROM professional_published_revisions WHERE profile_id=$1',[profile]);
  const audit=await a.query('SELECT count(*)::int AS total FROM professional_publication_audit WHERE profile_id=$1',[profile]);
  assert.equal(revision.rows[0].total,0);
  assert.equal(audit.rows[0].total,0);
 }finally{
  await b.query('ROLLBACK').catch(()=>{});
  await a.query('ROLLBACK').catch(()=>{});
  if(created){
   await a.query('BEGIN');
   try{
    await a.query('DELETE FROM service_offers WHERE id=$1',[offer]);
    await a.query('DELETE FROM professional_profiles WHERE id=$1',[profile]);
    await a.query('DELETE FROM sessions WHERE id=$1',[session]);
    await a.query('DELETE FROM persons WHERE id=$1',[person]);
    await a.query('DELETE FROM users WHERE id=$1',[user]);
    await a.query('DELETE FROM service_definitions WHERE id=$1',[service]);
    await a.query('DELETE FROM professions WHERE id=$1',[profession]);
    await a.query('COMMIT');
   }catch{await a.query('ROLLBACK').catch(()=>{});throw new Error('Failed to remove concurrency test fixtures');}
  }
  await Promise.all([a.end(),b.end()]);
 }
});
