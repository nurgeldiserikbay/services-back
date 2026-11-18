import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {PublicProfileRepository} from '../src/modules/catalog/public-profile.repository.js';
import type {DatabasePool} from '../src/platform/database/database.pool.js';

test('published snapshot is independent of draft edits and preserves null title',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const user=randomUUID(),person=randomUUID(),profession=randomUUID(),id=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await db.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status,title,about) VALUES($1,$2,$3,$4,'PUBLISHED',NULL,'original')",[id,person,profession,id]);
  const repo=new PublicProfileRepository(db as unknown as DatabasePool);
  assert.equal((await repo.professional(id)).title,null);
  await db.query("UPDATE professional_profiles SET title='private draft',about='private about',version=version+1 WHERE id=$1",[id]);
  assert.equal((await repo.professional(id)).title,null);
  const row=(await db.query('SELECT title,about,version,published_title,published_about,published_version FROM professional_profiles WHERE id=$1',[id])).rows[0];
  assert.deepEqual(row,{title:'private draft',about:'private about',version:2,published_title:null,published_about:'original',published_version:1});
  await db.query("UPDATE professional_profiles SET status='PAUSED' WHERE id=$1",[id]);
  await assert.rejects(repo.professional(id),/Public profile not found/);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
