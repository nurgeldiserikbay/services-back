import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';

test('published profile versions are immutable and retained across later publications',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 try{
  const user=randomUUID(),person=randomUUID(),profession=randomUUID(),id=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2)',[profession,profession]);
  await db.query("INSERT INTO professional_profiles(id,person_id,profession_id,slug,status,title,about) VALUES($1,$2,$3,$4,'PUBLISHED','first',NULL)",[id,person,profession,id]);
  const history=async()=>(await db.query('SELECT version,title,about FROM professional_published_revisions WHERE profile_id=$1 ORDER BY version',[id])).rows;
  assert.deepEqual(await history(),[{version:1,title:'first',about:null}]);
  await db.query("UPDATE professional_profiles SET title='second',about='draft',version=2 WHERE id=$1",[id]);
  assert.deepEqual(await history(),[{version:1,title:'first',about:null}]);
  await db.query("UPDATE professional_profiles SET published_title=title,published_about=about,published_version=version WHERE id=$1",[id]);
  const expected=[{version:1,title:'first',about:null},{version:2,title:'second',about:'draft'}];
  assert.deepEqual(await history(),expected);
  for(const sql of [
   "UPDATE professional_published_revisions SET title='tampered' WHERE profile_id=$1 AND version=1",
   "DELETE FROM professional_published_revisions WHERE profile_id=$1",
   "UPDATE professional_profiles SET published_title='tampered' WHERE id=$1",
   "UPDATE professional_profiles SET published_version=1,published_title='first',published_about=NULL WHERE id=$1",
  ]){
   await db.query('SAVEPOINT reject_mutation');
   await assert.rejects(db.query(sql,[id]),(error:unknown)=>(error as {code?:string}).code==='23514');
   await db.query('ROLLBACK TO SAVEPOINT reject_mutation');
   await db.query('RELEASE SAVEPOINT reject_mutation');
  }
  assert.deepEqual(await history(),expected);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
