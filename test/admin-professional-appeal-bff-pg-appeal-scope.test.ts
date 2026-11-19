import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {createAppealBffPgAppealScopeResolver} from '../src/modules/admin/admin-professional-appeal-bff-pg-appeal-scope.js';

test('real PostgreSQL appeal scope derives only from matching moderation case and profile',{
 skip:!process.env.DATABASE_URL,
},async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  await db.query(`CREATE TEMP TABLE platform_moderation_cases(
   id uuid PRIMARY KEY,resource_scope varchar(80) NOT NULL)`);
  await db.query(`CREATE TEMP TABLE professional_moderation_appeals(
   id uuid PRIMARY KEY,case_id uuid NOT NULL,profile_id uuid NOT NULL)`);
  const appealId=randomUUID(),caseId=randomUUID(),profileId=randomUUID();
  const otherAppeal=randomUUID(),otherCase=randomUUID(),otherProfile=randomUUID();
  const scoped='professional:'+profileId,otherScope='professional:'+otherProfile;
  await db.query(`INSERT INTO platform_moderation_cases(id,resource_scope)
   VALUES($1,$2),($3,$4)`,[caseId,scoped,otherCase,otherScope]);
  await db.query(`INSERT INTO professional_moderation_appeals(id,case_id,profile_id)
   VALUES($1,$2,$3),($4,$5,$6)`,
   [appealId,caseId,profileId,otherAppeal,otherCase,otherProfile]);
  const lookup=createAppealBffPgAppealScopeResolver(db);
  assert.equal(await lookup(appealId,'assignment'),scoped);
  assert.equal(await lookup(appealId,'decision'),scoped);
  assert.equal(await lookup(otherAppeal,'decision'),otherScope);
  assert.equal(await lookup(randomUUID(),'decision'),null);
  assert.equal(await lookup(appealId,'export'),null);
  assert.equal(await lookup('bad','decision'),null);
  await db.query(`UPDATE platform_moderation_cases
   SET resource_scope=$2 WHERE id=$1`,[caseId,otherScope]);
  assert.equal(await lookup(appealId,'decision'),null,'cross-profile scope mismatch must deny');
  await db.query('DELETE FROM platform_moderation_cases WHERE id=$1',[otherCase]);
  assert.equal(await lookup(otherAppeal,'assignment'),null,'orphan appeal must deny');
 }finally{await db.end();}
});

test('untrusted appeal identifiers and action types reject before querying PostgreSQL',async()=>{
 let queries=0;
 const lookup=createAppealBffPgAppealScopeResolver({
  query:async()=>{queries++;return {rows:[]};},
 } as never);
 for(const [id,action] of [
  [undefined,'decision'],[null,'assignment'],['x','decision'],
  [randomUUID(),'other'],[randomUUID(),null],['1 OR 1=1','decision'],
 ]){
  assert.equal(await lookup(id,action),null);
 }
 assert.equal(queries,0);
});

test('unexpected result rows and SQL failure do not manufacture an appeal scope',async()=>{
 const id=randomUUID();
 for(const rows of [[],[{}],[{resource_scope:'company:'+randomUUID()}],
  [{resource_scope:'professional:'+randomUUID()},{resource_scope:'professional:'+randomUUID()}]]){
  const lookup=createAppealBffPgAppealScopeResolver({
   query:async()=>({rows}),
  } as never);
  assert.equal(await lookup(id,'decision'),null);
 }
 const broken=createAppealBffPgAppealScopeResolver({
  query:async()=>{throw Error('postgres unavailable');},
 } as never);
 await assert.rejects(broken(id,'assignment'),/postgres unavailable/);
});
