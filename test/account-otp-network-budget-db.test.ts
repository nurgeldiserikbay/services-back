import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {
  checkAccountOtpNetworkBudget,recordAccountOtpNetworkIssuance,
  ACCOUNT_OTP_NETWORK_BUDGET,verifyAccountOtpNetworkProof,
} from '../src/modules/identity/account-otp-network-budget.js';
import {issueAccountOtpChallenge,AccountOtpIssuanceUnavailable}
  from '../src/modules/identity/account-otp-issuance.js';

const secrets=()=>({otpPepper:randomBytes(32),contactPepper:randomBytes(32),
  contactKey:randomBytes(32)});
const digest=()=>randomBytes(32).toString('hex');
async function openDb(){
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');return db;
}

test('trusted-edge OTP network assertion rejects forged, expired or malformed proof',()=>{
  const key=randomBytes(32),identity=digest(),now=Date.parse('2026-11-06T08:00:00Z');
  const signedAt=String(now);
  const mac=createHmac('sha256',key)
    .update('services-otp-network:v1\n').update(identity)
    .update('\n').update(signedAt).digest('hex');
  const proof='v1.'+identity+'.'+signedAt+'.'+mac;
  assert.equal(verifyAccountOtpNetworkProof(proof,key,now),identity);
  assert.equal(verifyAccountOtpNetworkProof(proof,key,now+31000),null);
  assert.equal(verifyAccountOtpNetworkProof(proof,randomBytes(32),now),null);
  assert.equal(verifyAccountOtpNetworkProof('127.0.0.1',key,now),null);
  assert.equal(verifyAccountOtpNetworkProof(proof,Buffer.alloc(5),now),null);
});

test('five private account sends per network block sixth and isolate other network',async()=>{
  const db=await openDb(),a=digest(),other=digest();
  try{
    assert.equal((await checkAccountOtpNetworkBudget(db,a)).allowed,true);
    for(let i=0;i<ACCOUNT_OTP_NETWORK_BUDGET.perMinute;i++)
      await recordAccountOtpNetworkIssuance(db,a);
    assert.deepEqual(await checkAccountOtpNetworkBudget(db,a),
      {allowed:false,retryAfterSeconds:60,reason:'network_minute'});
    assert.equal((await checkAccountOtpNetworkBudget(db,other)).allowed,true);
    const count=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM account_otp_network_issuances
      WHERE network_digest=$1`,[a]);
    assert.equal(count.rows[0].n,'5');
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('network-bound issuance inserts ledger and challenge in same transaction',async()=>{
  const db=await openDb(),networkDigest=digest(),keys=secrets();
  try{
    const created=await issueAccountOtpChallenge(db,{
      channel:'EMAIL',purpose:'SIGN_IN',contact:'private@example.com',networkDigest,
    },keys);
    const rows=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM account_otp_network_issuances
      WHERE network_digest=$1`,[networkDigest]);
    assert.equal(rows.rows[0].n,'1');
    const challenge=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM account_auth_challenges WHERE id=$1`,
      [created.challengeId]);
    assert.equal(challenge.rows[0].n,'1');
    await assert.rejects(issueAccountOtpChallenge(db,{
      channel:'EMAIL',purpose:'SIGN_UP',contact:'private@example.com',
      networkDigest:'untrusted',
    },keys));
    const still=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM account_otp_network_issuances
      WHERE network_digest=$1`,[networkDigest]);
    assert.equal(still.rows[0].n,'1');
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('network ceiling rejects fresh contacts without writing OTP',async()=>{
  const db=await openDb(),networkDigest=digest(),keys=secrets();
  try{
    for(let i=0;i<ACCOUNT_OTP_NETWORK_BUDGET.perMinute;i++)
      await recordAccountOtpNetworkIssuance(db,networkDigest);
    await assert.rejects(issueAccountOtpChallenge(db,{
      channel:'EMAIL',purpose:'SIGN_UP',contact:'unique-contact@example.com',networkDigest,
    },keys),AccountOtpIssuanceUnavailable);
    const missing=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM account_auth_challenges
      WHERE contact_digest=$1`,['f'.repeat(64)]);
    assert.equal(missing.rows[0].n,'0');
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
