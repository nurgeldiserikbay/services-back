import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {ServiceUnavailableException} from '@nestjs/common';
import {
  AccountOtpSignInService,
} from '../src/modules/identity/account-otp-sign-in.service.js';
import {issueAccountOtpChallenge} from '../src/modules/identity/account-otp-issuance.js';
import {resolveActiveUserSession} from '../src/modules/identity/session-proof.js';

const keys=()=>({
  otpPepper:randomBytes(32),contactPepper:randomBytes(32),
  contactKey:randomBytes(32),sessionPepper:randomBytes(32),
});
const makeRunner=(client:Client)=>({
  transaction:async<T>(work:(db:Client)=>Promise<T>):Promise<T>=>work(client),
});
async function open(){
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');return db;
}

test('transactional sign-in returns a session for confirmed active user only once',async()=>{
  const db=await open(),secret=keys(),userId=randomUUID();
  try{
    const email='orchestrator-success@example.test';
    await db.query('INSERT INTO users(id,email) VALUES($1,$2)',[userId,email]);
    const otp=await issueAccountOtpChallenge(db,{
      channel:'EMAIL',purpose:'SIGN_IN',contact:email,
    },secret);
    await db.query('UPDATE account_auth_challenges SET delivery_confirmed_at=now() WHERE id=$1',
      [otp.challengeId]);
    const service=new AccountOtpSignInService(makeRunner(db) as never,()=>secret);
    const attempt={challengeId:otp.challengeId,channel:'EMAIL' as const,code:otp.code};
    const receipt=await service.signIn(attempt);
    assert.ok(receipt);
    assert.equal(receipt.userId,userId);
    assert.deepEqual(await resolveActiveUserSession(db,receipt.sessionToken,secret.sessionPepper),
      {userId,sessionId:receipt.sessionId});
    assert.equal(await service.signIn(attempt),null);
    const rows=await db.query<{n:string}>(
      'SELECT count(*)::text AS n FROM sessions WHERE user_id=$1',[userId]);
    assert.equal(rows.rows[0].n,'1');
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('invalid guesses remain charged, unconfirmed OTP never issues a session',async()=>{
  const db=await open(),secret=keys();
  try{
    const otp=await issueAccountOtpChallenge(db,{
      channel:'SMS',purpose:'SIGN_IN',contact:'+77018881122',
    },secret);
    const service=new AccountOtpSignInService(makeRunner(db) as never,()=>secret);
    const wrong=otp.code==='123456'?'654321':'123456';
    assert.equal(await service.signIn({
      challengeId:otp.challengeId,channel:'SMS',code:otp.code,
    }),null);
    await db.query('UPDATE account_auth_challenges SET delivery_confirmed_at=now() WHERE id=$1',
      [otp.challengeId]);
    assert.equal(await service.signIn({
      challengeId:otp.challengeId,channel:'SMS',code:wrong,
    }),null);
    const rows=await db.query<{attempts:number;consumed_at:Date|null}>(`
      SELECT attempts,consumed_at FROM account_auth_challenges WHERE id=$1
    `,[otp.challengeId]);
    assert.equal(rows.rows[0].attempts,1);
    assert.equal(rows.rows[0].consumed_at,null);
    // A correct code for an unknown account is consumed, never reused to
    // create a registered account or leak existence.
    assert.equal(await service.signIn({
      challengeId:otp.challengeId,channel:'SMS',code:otp.code,
    }),null);
    const after=await db.query<{attempts:number;consumed_at:Date|null}>(`
      SELECT attempts,consumed_at FROM account_auth_challenges WHERE id=$1
    `,[otp.challengeId]);
    assert.equal(after.rows[0].attempts,2);
    assert.ok(after.rows[0].consumed_at);
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('sign-in input validation is fail-closed without touching transaction',async()=>{
  let tx=0;
  const service=new AccountOtpSignInService({
    transaction:async()=>{tx++;throw new Error('should never run');},
  } as never);
  for(const value of [
    {challengeId:'invalid',channel:'EMAIL',code:'123456'},
    {challengeId:randomUUID(),channel:'UNKNOWN',code:'123456'},
    {challengeId:randomUUID(),channel:'SMS',code:'12345'},
    null,
  ]){
    assert.equal(await service.signIn(value as never),null);
  }
  assert.equal(tx,0);
});

test('database failures are sanitized and no successful proof is returned',async()=>{
  const secret=keys();
  let rolledBack=false;
  const service=new AccountOtpSignInService({
    transaction:async()=>{rolledBack=true;throw new Error('secret database detail');},
  } as never,()=>secret);
  await assert.rejects(service.signIn({
    challengeId:randomUUID(),channel:'EMAIL',code:'123456',
  }),err=>{
    assert.ok(err instanceof ServiceUnavailableException);
    assert.doesNotMatch(err.message,/secret database detail/);
    return true;
  });
  assert.equal(rolledBack,true);
});
