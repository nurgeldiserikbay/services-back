import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {
  SESSION_ACTIVITY_INTERVAL_SECONDS,resolveAndTouchActiveUserSession,
} from '../src/modules/identity/account-session-activity.js';
import {listMyAccountSessions} from '../src/modules/identity/account-session-management.js';

async function open(){
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');return db;
}
async function seed(db:Client,pepper:Buffer,options:{
 status?:'ACTIVE'|'SUSPENDED';expires?:'future'|'past';revoked?:boolean;
}={}){
 const userId=randomUUID(),sessionId=randomUUID();
 const token=issueSessionToken(pepper);
 await db.query('INSERT INTO users(id,status) VALUES($1,$2)',
  [userId,options.status??'ACTIVE']);
 await db.query(`
  INSERT INTO sessions(id,user_id,token_hash,family_id,expires_at,revoked_at)
  VALUES($1,$2,$3,$4,
    CASE WHEN $5::boolean THEN now()-interval '1 second'
         ELSE now()+interval '1 hour' END,
    CASE WHEN $6::boolean THEN now() ELSE NULL END)
 `,[sessionId,userId,token.hash,randomUUID(),
     options.expires==='past',options.revoked===true]);
 return {...token,userId,sessionId};
}

test('activity updates current active session once then throttles without extending expiry',async()=>{
 const db=await open(),key=randomBytes(32);
 try{
  const a=await seed(db,key);
  assert.equal(SESSION_ACTIVITY_INTERVAL_SECONDS,300);
  const proof=await resolveAndTouchActiveUserSession(db,a.token,key);
  assert.deepEqual(proof,{userId:a.userId,sessionId:a.sessionId});
  const first=await db.query<{last_used_at:Date;expires_at:Date}>(`
   SELECT last_used_at,expires_at FROM sessions WHERE id=$1`,[a.sessionId]);
  assert.ok(first.rows[0].last_used_at instanceof Date);
  const timestamp=first.rows[0].last_used_at.getTime();
  assert.deepEqual(await resolveAndTouchActiveUserSession(db,a.token,key),proof);
  const second=await db.query<{last_used_at:Date;expires_at:Date}>(`
   SELECT last_used_at,expires_at FROM sessions WHERE id=$1`,[a.sessionId]);
  assert.equal(second.rows[0].last_used_at.getTime(),timestamp);
  assert.equal(second.rows[0].expires_at.getTime(),
    first.rows[0].expires_at.getTime());
  await db.query(`UPDATE sessions SET last_used_at=now()-interval '6 minutes'
     WHERE id=$1`,[a.sessionId]);
  assert.deepEqual(await resolveAndTouchActiveUserSession(db,a.token,key),proof);
  const third=await db.query<{last_used_at:Date}>(`
    SELECT last_used_at FROM sessions WHERE id=$1`,[a.sessionId]);
  assert.ok(third.rows[0].last_used_at.getTime()>timestamp-1000);
  const listed=await listMyAccountSessions(db,a.token,key);
  assert.equal(listed?.length,1);
  assert.equal(listed?.[0].lastUsedAt?.getTime(),third.rows[0].last_used_at.getTime());
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('expired, suspended and revoked sessions never record activity',async()=>{
 const db=await open(),key=randomBytes(32);
 try{
  for(const options of [{expires:'past'},{status:'SUSPENDED'},{revoked:true}] as const){
   const a=await seed(db,key,options);
   assert.equal(await resolveAndTouchActiveUserSession(db,a.token,key),null);
   const row=await db.query<{last_used_at:Date|null}>(`
     SELECT last_used_at FROM sessions WHERE id=$1`,[a.sessionId]);
   assert.equal(row.rows[0].last_used_at,null);
   assert.equal(await listMyAccountSessions(db,a.token,key),null);
  }
  assert.equal(await resolveAndTouchActiveUserSession(db,'invalid',key),null);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('tampered session token cannot touch another user session',async()=>{
 const db=await open(),key=randomBytes(32);
 try{
  const first=await seed(db,key),other=await seed(db,key);
  assert.equal(await resolveAndTouchActiveUserSession(db,
   issueSessionToken(randomBytes(32)).token,key),null);
  assert.deepEqual(await resolveAndTouchActiveUserSession(db,first.token,key),
   {userId:first.userId,sessionId:first.sessionId});
  const row=await db.query<{last_used_at:Date|null}>(`
    SELECT last_used_at FROM sessions WHERE id=$1`,[other.sessionId]);
  assert.equal(row.rows[0].last_used_at,null);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
