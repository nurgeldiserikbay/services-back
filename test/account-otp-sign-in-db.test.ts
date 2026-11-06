import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {issueAccountOtpChallenge} from '../src/modules/identity/account-otp-issuance.js';
import {signInWithVerifiedAccountOtp,ACCOUNT_SIGN_IN_SESSION_TTL_SECONDS}
 from '../src/modules/identity/account-otp-sign-in.js';
import {resolveActiveUserSession} from '../src/modules/identity/session-proof.js';

const keys=()=>({
 otpPepper:randomBytes(32),contactPepper:randomBytes(32),
 contactKey:randomBytes(32),sessionPepper:randomBytes(32),
});
async function dbOpen(){
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');return db;
}
test('verified email OTP grants an active account one opaque session and cannot replay',async()=>{
 const db=await dbOpen(),secret=keys(),userId=randomUUID();
 try{
  await db.query('INSERT INTO users(id,email) VALUES($1,$2)',
   [userId,'account-test@example.com']);
  const challenge=await issueAccountOtpChallenge(db,{
    channel:'EMAIL',purpose:'SIGN_IN',contact:'account-test@example.com',
  },secret);
  const login=await signInWithVerifiedAccountOtp(db,{
    challengeId:challenge.challengeId,channel:'EMAIL',code:challenge.code,
  },secret);
  assert.ok(login);
  assert.equal(login?.userId,userId);
  assert.equal(login?.expiresInSeconds,ACCOUNT_SIGN_IN_SESSION_TTL_SECONDS);
  assert.match(login?.sessionToken??'',/^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await resolveActiveUserSession(db,login?.sessionToken,secret.sessionPepper),
    {userId,sessionId:login?.sessionId});
  const rows=await db.query<{token_hash:string;family_id:string}>(
    'SELECT token_hash,family_id FROM sessions WHERE id=$1',[login?.sessionId]);
  assert.equal(rows.rows.length,1);
  assert.notEqual(rows.rows[0].token_hash,login?.sessionToken);
  assert.ok(rows.rows[0].family_id);
  assert.equal(await signInWithVerifiedAccountOtp(db,{
    challengeId:challenge.challengeId,channel:'EMAIL',code:challenge.code,
  },secret),null);
  const count=await db.query<{n:string}>(
    'SELECT count(*)::text n FROM sessions WHERE user_id=$1',[userId]);
  assert.equal(count.rows[0].n,'1');
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
test('unknown and suspended accounts never receive session even with valid OTP',async()=>{
 const db=await dbOpen(),secret=keys();
 try{
  const unregistered=await issueAccountOtpChallenge(db,{
    channel:'EMAIL',purpose:'SIGN_IN',contact:'no-account@example.com',
  },secret);
  assert.equal(await signInWithVerifiedAccountOtp(db,{
    challengeId:unregistered.challengeId,channel:'EMAIL',code:unregistered.code,
  },secret),null);
  const used=await db.query<{consumed_at:Date|null}>(
    'SELECT consumed_at FROM account_auth_challenges WHERE id=$1',
    [unregistered.challengeId]);
  assert.ok(used.rows[0].consumed_at);
  const suspendedId=randomUUID();
  await db.query('INSERT INTO users(id,phone,status) VALUES($1,$2,$3)',
    [suspendedId,'+77010000001','SUSPENDED']);
  const suspended=await issueAccountOtpChallenge(db,{
    channel:'SMS',purpose:'SIGN_IN',contact:'+77010000001',
  },secret);
  assert.equal(await signInWithVerifiedAccountOtp(db,{
    challengeId:suspended.challengeId,channel:'SMS',code:suspended.code,
  },secret),null);
  const count=await db.query<{n:string}>(
    'SELECT count(*)::text n FROM sessions WHERE user_id=$1',[suspendedId]);
  assert.equal(count.rows[0].n,'0');
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
test('signup OTP, wrong channel, invalid code and contact tampering cannot issue session',async()=>{
 const db=await dbOpen(),secret=keys(),userId=randomUUID();
 try{
  await db.query('INSERT INTO users(id,email) VALUES($1,$2)',
    [userId,'different@example.com']);
  const signup=await issueAccountOtpChallenge(db,{
    channel:'EMAIL',purpose:'SIGN_UP',contact:'different@example.com',
  },secret);
  assert.equal(await signInWithVerifiedAccountOtp(db,{
    challengeId:signup.challengeId,channel:'EMAIL',code:signup.code,
  },secret),null);
  const signIn=await issueAccountOtpChallenge(db,{
    channel:'EMAIL',purpose:'SIGN_IN',contact:'another@example.com',
  },secret);
  assert.equal(await signInWithVerifiedAccountOtp(db,{
    challengeId:signIn.challengeId,channel:'SMS',code:signIn.code,
  },secret),null);
  assert.equal(await signInWithVerifiedAccountOtp(db,{
    challengeId:signIn.challengeId,channel:'EMAIL',
    code:signIn.code==='000000'?'111111':'000000',
  },secret),null);
  await db.query('UPDATE account_auth_challenges SET contact_digest=$2 WHERE id=$1',
   [signIn.challengeId,'0'.repeat(64)]);
  assert.equal(await signInWithVerifiedAccountOtp(db,{
    challengeId:signIn.challengeId,channel:'EMAIL',code:signIn.code,
  },secret),null);
  const rows=await db.query<{n:string}>(
    'SELECT count(*)::text n FROM sessions WHERE user_id=$1',[userId]);
  assert.equal(rows.rows[0].n,'0');
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
