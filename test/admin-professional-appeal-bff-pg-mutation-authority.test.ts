import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {withAppealBffPgMutationAuthority} from '../src/modules/admin/admin-professional-appeal-bff-pg-mutation-authority.js';

test('real PostgreSQL mutation work executes only under current locked MFA, grant and appeal scope',{
 skip:!process.env.DATABASE_URL,
},async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  await db.query('CREATE TEMP TABLE users(id uuid PRIMARY KEY,status text NOT NULL)');
  await db.query('CREATE TEMP TABLE platform_admin_staff(id uuid PRIMARY KEY,user_id uuid NOT NULL,role text NOT NULL,disabled_at timestamptz)');
  await db.query('CREATE TEMP TABLE platform_admin_sessions(id uuid PRIMARY KEY,staff_id uuid NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz,mfa_verified_at timestamptz NOT NULL)');
  await db.query('CREATE TEMP TABLE platform_admin_totp_factors(staff_id uuid PRIMARY KEY,activated_at timestamptz,disabled_at timestamptz)');
  await db.query('CREATE TEMP TABLE platform_admin_grants(staff_id uuid NOT NULL,scope text NOT NULL)');
  await db.query('CREATE TEMP TABLE professional_moderation_appeals(id uuid PRIMARY KEY,case_id uuid NOT NULL,profile_id uuid NOT NULL)');
  await db.query('CREATE TEMP TABLE platform_moderation_cases(id uuid PRIMARY KEY,resource_scope text NOT NULL)');
  await db.query('CREATE TEMP TABLE platform_admin_appeal_browser_sessions(id uuid PRIMARY KEY,staff_id uuid NOT NULL,admin_session_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz)');
  await db.query('CREATE TEMP TABLE bff_mutation_effects(id uuid PRIMARY KEY)');
  const user=randomUUID(),staff=randomUUID(),parent=randomUUID(),browser=randomUUID(),
   appeal=randomUUID(),moderation=randomUUID(),profile=randomUUID(),scope='professional:'+profile;
  await db.query("INSERT INTO users VALUES($1,'ACTIVE')",[user]);
  await db.query("INSERT INTO platform_admin_staff VALUES($1,$2,'admin',NULL)",[staff,user]);
  await db.query(`INSERT INTO platform_admin_sessions VALUES($1,$2,now()-interval '3 minutes',
   now()+interval '50 minutes',NULL,now()-interval '2 minutes')`,[parent,staff]);
  await db.query("INSERT INTO platform_admin_totp_factors VALUES($1,now()-interval '3 minutes',NULL)",[staff]);
  await db.query('INSERT INTO platform_admin_grants VALUES($1,$2)',[staff,scope]);
  await db.query('INSERT INTO platform_moderation_cases VALUES($1,$2)',[moderation,scope]);
  await db.query('INSERT INTO professional_moderation_appeals VALUES($1,$2,$3)',[appeal,moderation,profile]);
  await db.query(`INSERT INTO platform_admin_appeal_browser_sessions VALUES(
   $1,$2,$3,now()+interval '10 minutes',NULL)`,[browser,staff,parent]);
  let effects=0;
  async function attempt(expected:boolean,caseId=appeal){
   const effectId=randomUUID();
   const result=await withAppealBffPgMutationAuthority(db,browser,caseId,'decision',async(client)=>{
    effects++;
    await client.query('INSERT INTO bff_mutation_effects(id) VALUES($1)',[effectId]);
    return {effectId};
   });
   assert.equal(result!==null,expected);
   const stored=await db.query('SELECT id FROM bff_mutation_effects WHERE id=$1',[effectId]);
   assert.equal(stored.rows.length,expected?1:0);
  }
  await attempt(true);
  await attempt(false,randomUUID());
  await db.query('DELETE FROM platform_admin_grants');
  await attempt(false);
  await db.query('INSERT INTO platform_admin_grants VALUES($1,$2)',[staff,scope]);
  await db.query("UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '17 minutes'");
  await attempt(false);
  await db.query("UPDATE platform_admin_sessions SET mfa_verified_at=now()-interval '2 minutes'");
  await db.query('UPDATE platform_admin_totp_factors SET disabled_at=now()');
  await attempt(false);
  await db.query('UPDATE platform_admin_totp_factors SET disabled_at=NULL');
  await db.query("UPDATE platform_admin_staff SET role='auditor'");
  await attempt(false);
  await db.query("UPDATE platform_admin_staff SET role='admin'");
  await db.query('UPDATE platform_moderation_cases SET resource_scope=$1',['professional:'+randomUUID()]);
  await attempt(false);
  await db.query('UPDATE platform_moderation_cases SET resource_scope=$1',[scope]);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=now()');
  await attempt(false);
  await db.query('UPDATE platform_admin_sessions SET revoked_at=NULL');
  await attempt(true);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM bff_mutation_effects')).rows[0]?.count,2);
  assert.equal(effects,2);
  await assert.rejects(withAppealBffPgMutationAuthority(db,browser,appeal,'assignment',async(client)=>{
   await client.query('INSERT INTO bff_mutation_effects(id) VALUES($1)',[randomUUID()]);
   throw Error('case decision rejected');
  }),/case decision rejected/);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM bff_mutation_effects')).rows[0]?.count,2,
   'failed privileged mutation must rollback side effects');
 }finally{await db.end();}
});

test('invalid browser, appeal or action fails before BEGIN',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;return {rows:[]};}};
 const work=async()=>{throw Error('must not run');};
 const valid=randomUUID();
 for(const [browser,appeal,action] of [
  ['bad',valid,'decision'],[valid,'bad','assignment'],
  [valid,valid,'export'],[null,valid,'decision'],
 ]){
  assert.equal(await withAppealBffPgMutationAuthority(db as never,browser,appeal,action,work),null);
 }
 assert.equal(calls,0);
});

test('ambiguous authority, SQL errors and commit uncertainty deny or rollback',async()=>{
 const session=randomUUID(),appeal=randomUUID();
 let calls:string[]=[];
 const db={query:async(sql:string)=>{
  calls.push(sql);
  if(sql==='BEGIN'||sql==='ROLLBACK')return {rows:[]};
  if(sql.includes('SELECT browser.id::text'))return {rows:[]};
  throw Error('unexpected SQL');
 }};
 assert.equal(await withAppealBffPgMutationAuthority(db as never,session,appeal,'decision',
  async()=>{throw Error('must not execute');}),null);
 assert.deepEqual(calls.slice(0,1),['BEGIN']);
 assert.equal(calls.at(-1),'ROLLBACK');
 calls=[];
 const broken={query:async(sql:string)=>{
  calls.push(sql);
  if(sql==='BEGIN'||sql==='ROLLBACK')return {rows:[]};
  throw Error('postgres unavailable');
 }};
 await assert.rejects(withAppealBffPgMutationAuthority(broken as never,session,appeal,'decision',
  async()=>null),/postgres unavailable/);
 assert.equal(calls.at(-1),'ROLLBACK');
});
