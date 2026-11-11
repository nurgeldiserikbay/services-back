import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {hashSessionToken,issueSessionToken,resolveActiveUserSession} from '../src/modules/identity/session-proof.js';

test('session proof uses 256-bit opaque tokens and domain-separated hash',()=>{
 const key=randomBytes(32),a=issueSessionToken(key),b=issueSessionToken(key);
 assert.match(a.token,/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
 assert.notEqual(a.hash,a.token);
 assert.notEqual(a.hash,b.hash);
 assert.equal(hashSessionToken(a.token,key),a.hash);
 assert.throws(()=>hashSessionToken('short',key));
});

test('active session resolves user; revoked, expired and suspended are denied',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 const key=randomBytes(32);
 try{
   const userId=randomUUID(),sessionId=randomUUID(),familyId=randomUUID();
   const {token,hash}=issueSessionToken(key);
   await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
   await db.query(`INSERT INTO sessions
     (id,user_id,token_hash,family_id,expires_at)
     VALUES($1,$2,$3,$4,now()+interval '1 day')`,
     [sessionId,userId,hash,familyId]);
   assert.deepEqual(await resolveActiveUserSession(db,token,key),
     {userId,sessionId});
   assert.equal(await resolveActiveUserSession(db,'malformed',key),null);
   // Reject a noncanonical base64url spelling before the database lookup.
   assert.equal(await resolveActiveUserSession(db,token.slice(0,-1)+'B',key),null);
   assert.equal(await resolveActiveUserSession(db,issueSessionToken(key).token,key),null);
   await db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[sessionId]);
   assert.equal(await resolveActiveUserSession(db,token,key),null);
   await db.query('UPDATE sessions SET revoked_at=NULL,expires_at=now()-interval \'1 second\' WHERE id=$1',[sessionId]);
   assert.equal(await resolveActiveUserSession(db,token,key),null);
   await db.query('UPDATE sessions SET expires_at=now()+interval \'1 day\' WHERE id=$1',[sessionId]);
   await db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[userId]);
   assert.equal(await resolveActiveUserSession(db,token,key),null);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
