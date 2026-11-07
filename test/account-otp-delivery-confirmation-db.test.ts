import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {issueAccountOtpChallenge} from '../src/modules/identity/account-otp-issuance.js';
import {consumeAccountOtpChallenge} from '../src/modules/identity/account-otp-verification.js';
import {signInWithVerifiedAccountOtp}
 from '../src/modules/identity/account-otp-sign-in.js';

const secrets=()=>({
 otpPepper:randomBytes(32),contactPepper:randomBytes(32),
 contactKey:randomBytes(32),sessionPepper:randomBytes(32),
});
test('unconfirmed account OTP cannot verify or issue a session after a simulated crash',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 const secret=secrets(),userId=randomUUID();
 try{
  await db.query('INSERT INTO users(id,email) VALUES($1,$2)',
   [userId,'inert-otp@example.com']);
  const challenge=await issueAccountOtpChallenge(db,{
   channel:'EMAIL',purpose:'SIGN_IN',contact:'inert-otp@example.com',
  },secret);
  assert.equal(await consumeAccountOtpChallenge(db,challenge.challengeId,
   'SIGN_IN','EMAIL',challenge.code,secret.otpPepper),null);
  assert.equal(await signInWithVerifiedAccountOtp(db,{
   challengeId:challenge.challengeId,channel:'EMAIL',code:challenge.code,
  },secret),null);
  const before=await db.query<{
    attempts:number;consumed_at:Date|null;delivery_confirmed_at:Date|null;
  }>('SELECT attempts,consumed_at,delivery_confirmed_at FROM account_auth_challenges WHERE id=$1',
    [challenge.challengeId]);
  assert.equal(before.rows[0].attempts,0);
  assert.equal(before.rows[0].consumed_at,null);
  assert.equal(before.rows[0].delivery_confirmed_at,null);

  // Only the trusted dispatch side may write this marker after provider
  // acceptance, never a public browser-provided acknowledgement.
  await db.query(`
   UPDATE account_auth_challenges SET delivery_confirmed_at=now()
   WHERE id=$1 AND consumed_at IS NULL AND expires_at>now()
  `,[challenge.challengeId]);
  assert.ok(await consumeAccountOtpChallenge(db,challenge.challengeId,
   'SIGN_IN','EMAIL',challenge.code,secret.otpPepper));
  assert.equal(await consumeAccountOtpChallenge(db,challenge.challengeId,
   'SIGN_IN','EMAIL',challenge.code,secret.otpPepper),null);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
