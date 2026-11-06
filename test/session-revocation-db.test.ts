import{test}from'node:test';
import assert from'node:assert/strict';
import{randomBytes,randomUUID}from'node:crypto';
import{Client}from'pg';
import{issueSessionToken,resolveActiveUserSession}from'../src/modules/identity/session-proof.js';
import{
  revokeCurrentAccountSession,revokeCurrentAccountSessionFamily,
}from'../src/modules/identity/session-revocation.js';

const makeDb=()=>new Client({connectionString:process.env.DATABASE_URL});
async function session(db:Client,userId:string,familyId:string,pepper:Buffer){
  const id=randomUUID(),proof=issueSessionToken(pepper);
  await db.query(`
    INSERT INTO sessions (id,user_id,token_hash,family_id,expires_at)
    VALUES ($1,$2,$3,$4,now()+interval '1 day')
  `,[id,userId,proof.hash,familyId]);
  return {...proof,id};
}

test('logout revokes only authenticated current session, never siblings',async()=>{
  const db=makeDb();await db.connect();await db.query('BEGIN');
  const pepper=randomBytes(32);
  try{
    const userId=randomUUID(),familyId=randomUUID();
    await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
    const first=await session(db,userId,familyId,pepper);
    const sibling=await session(db,userId,familyId,pepper);
    assert.equal(await revokeCurrentAccountSession(db,first.token,pepper),true);
    assert.equal(await resolveActiveUserSession(db,first.token,pepper),null);
    assert.equal((await resolveActiveUserSession(db,sibling.token,pepper))?.userId,userId);
    assert.equal(await revokeCurrentAccountSession(db,first.token,pepper),false);
    assert.equal(await revokeCurrentAccountSession(db,'invalid',pepper),false);
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('family revocation does not affect other families or users',async()=>{
  const db=makeDb();await db.connect();await db.query('BEGIN');
  const pepper=randomBytes(32);
  try{
    const userId=randomUUID(),otherUser=randomUUID();
    const family=randomUUID(),otherFamily=randomUUID();
    await db.query('INSERT INTO users(id) VALUES($1),($2)',[userId,otherUser]);
    const first=await session(db,userId,family,pepper);
    const sibling=await session(db,userId,family,pepper);
    const otherDevice=await session(db,userId,otherFamily,pepper);
    const stranger=await session(db,otherUser,family,pepper);
    assert.equal(await revokeCurrentAccountSessionFamily(db,first.token,pepper),2);
    assert.equal(await resolveActiveUserSession(db,first.token,pepper),null);
    assert.equal(await resolveActiveUserSession(db,sibling.token,pepper),null);
    assert.equal((await resolveActiveUserSession(db,otherDevice.token,pepper))?.userId,userId);
    assert.equal((await resolveActiveUserSession(db,stranger.token,pepper))?.userId,otherUser);
    assert.equal(await revokeCurrentAccountSessionFamily(db,first.token,pepper),0);
    assert.equal(await revokeCurrentAccountSessionFamily(db,'bad',pepper),0);
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('expired and suspended account sessions cannot revoke other sessions',async()=>{
  const db=makeDb();await db.connect();await db.query('BEGIN');
  const pepper=randomBytes(32);
  try{
    const userId=randomUUID(),family=randomUUID();
    await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
    const expired=await session(db,userId,family,pepper);
    const stillActive=await session(db,userId,family,pepper);
    await db.query('UPDATE sessions SET expires_at=now()-interval \'1 second\' WHERE id=$1',
      [expired.id]);
    assert.equal(await revokeCurrentAccountSessionFamily(db,expired.token,pepper),0);
    assert.ok(await resolveActiveUserSession(db,stillActive.token,pepper));
    await db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[userId]);
    assert.equal(await revokeCurrentAccountSessionFamily(db,stillActive.token,pepper),0);
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
