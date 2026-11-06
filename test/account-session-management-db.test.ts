import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {issueSessionToken,resolveActiveUserSession}
  from '../src/modules/identity/session-proof.js';
import {ACCOUNT_SESSION_LIST_LIMIT,listMyAccountSessions,
  revokeMyAccountSessionById}
  from '../src/modules/identity/account-session-management.js';

async function open(){
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');return db;
}
async function makeSession(db:Client,userId:string,pepper:Buffer,label:string){
 const id=randomUUID(),token=issueSessionToken(pepper);
 await db.query(`
   INSERT INTO sessions(id,user_id,token_hash,family_id,
      device_label,expires_at)
   VALUES($1,$2,$3,$4,$5,now()+interval '1 day')
 `,[id,userId,token.hash,randomUUID(),label]);
 return {id,token:token.token};
}

test('session inventory is bounded, scoped and excludes token hashes',async()=>{
 const db=await open(),key=randomBytes(32);
 try{
  const owner=randomUUID(),other=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1),($2)',[owner,other]);
  const current=await makeSession(db,owner,key,'Current');
  const sibling=await makeSession(db,owner,key,'Laptop');
  const outsider=await makeSession(db,other,key,'Unrelated');
  const items=await listMyAccountSessions(db,current.token,key);
  assert.ok(items);
  assert.equal(items?.length,2);
  assert.ok(items?.some(x=>x.id===current.id&&x.current));
  assert.ok(items?.some(x=>x.id===sibling.id&&!x.current));
  assert.equal(items?.some(x=>x.id===outsider.id),false);
  assert.equal(items?.some(x=>'tokenHash' in x||'familyId' in x),false);
  assert.equal(items?.some(x=>JSON.stringify(x).includes(current.token)),false);
  assert.equal(await listMyAccountSessions(db,'malformed',key),null);
  assert.equal(ACCOUNT_SESSION_LIST_LIMIT,50);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('revoke-by-id affects only verified owner; replay is harmless',async()=>{
 const db=await open(),key=randomBytes(32);
 try{
  const owner=randomUUID(),other=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1),($2)',[owner,other]);
  const current=await makeSession(db,owner,key,'Current');
  const sibling=await makeSession(db,owner,key,'Another');
  const outsider=await makeSession(db,other,key,'Foreign');
  assert.equal(await revokeMyAccountSessionById(db,current.token,key,outsider.id),false);
  assert.equal(await revokeMyAccountSessionById(db,current.token,key,'bad'),false);
  assert.equal(await revokeMyAccountSessionById(db,current.token,key,sibling.id),true);
  assert.equal(await revokeMyAccountSessionById(db,current.token,key,sibling.id),false);
  assert.equal(await resolveActiveUserSession(db,sibling.token,key),null);
  assert.ok(await resolveActiveUserSession(db,current.token,key));
  assert.ok(await resolveActiveUserSession(db,outsider.token,key));
  assert.equal(await revokeMyAccountSessionById(db,current.token,key,current.id),true);
  assert.equal(await listMyAccountSessions(db,current.token,key),null);
  assert.equal(await revokeMyAccountSessionById(db,current.token,key,outsider.id),false);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('expired and suspended actor cannot list or revoke another session',async()=>{
 const db=await open(),key=randomBytes(32);
 try{
  const owner=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[owner]);
  const old=await makeSession(db,owner,key,'Expired');
  const active=await makeSession(db,owner,key,'Active');
  await db.query(`UPDATE sessions SET expires_at=now()-interval '1 second'
    WHERE id=$1`,[old.id]);
  assert.equal(await listMyAccountSessions(db,old.token,key),null);
  assert.equal(await revokeMyAccountSessionById(db,old.token,key,active.id),false);
  await db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[owner]);
  assert.equal(await listMyAccountSessions(db,active.token,key),null);
  assert.equal(await revokeMyAccountSessionById(db,active.token,key,active.id),false);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
