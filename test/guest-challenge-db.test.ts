import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {GUEST_OTP_POLICY,hashOtp,issueGuestCapability} from '../src/modules/guest-requests/guest-request.security.js';
import {VERIFY_CREATE_REQUEST_CHALLENGE_SQL} from '../src/modules/guest-requests/guest-challenge-proof.repository.js';

test('one correct OTP produces one capability, wrong guesses count, replay fails',async()=>{
  const url=process.env.DATABASE_URL;
  if(!url) throw new Error('DATABASE_URL required for PostgreSQL integration test');
  const db=new Client({connectionString:url});
  await db.connect();
  const contactId=randomUUID(),challengeId=randomUUID();
  const pepper=randomBytes(32),otp='234567';
  const digest='test-guest-'+randomUUID();
  try{
    await db.query('BEGIN');
    await db.query(`INSERT INTO guest_contacts
      (id,channel,encrypted_value,digest,expires_at)
      VALUES($1,'email','encrypted-fixture',$2,now() + interval '1 day')`,[contactId,digest]);
    await db.query(`INSERT INTO guest_challenges
      (id,guest_contact_id,code_hash,purpose,expires_at)
      VALUES($1,$2,$3,'CREATE_REQUEST',now() + interval '10 minutes')`,
      [challengeId,contactId,hashOtp(challengeId,otp,pepper)]);

    async function attempt(code:string) {
      const hash=hashOtp(challengeId,code,pepper);
      const token=issueGuestCapability('CREATE_REQUEST',pepper);
      const {rows}=await db.query<{verified:boolean}>(VERIFY_CREATE_REQUEST_CHALLENGE_SQL,[
        challengeId,hash,randomUUID(),token.tokenHash,
        GUEST_OTP_POLICY.maxAttempts,GUEST_OTP_POLICY.capabilityTtlSeconds,
      ]);
      return rows[0].verified;
    }

    assert.equal(await attempt('999999'),false);
    const initial=await db.query<{attempts:number;consumed_at:Date|null}>(
      'SELECT attempts,consumed_at FROM guest_challenges WHERE id=$1',[challengeId]);
    assert.equal(initial.rows[0].attempts,1);
    assert.equal(initial.rows[0].consumed_at,null);
    assert.equal(await attempt(otp),true);
    assert.equal(await attempt(otp),false);
    const after=await db.query<{attempts:number;consumed_at:Date|null}>(
      'SELECT attempts,consumed_at FROM guest_challenges WHERE id=$1',[challengeId]);
    assert.equal(after.rows[0].attempts,2);
    assert.ok(after.rows[0].consumed_at);
    const proof=await db.query<{total:string}>(
      "SELECT count(*)::text AS total FROM guest_capabilities WHERE guest_contact_id=$1 AND scope='CREATE_REQUEST'",[contactId]);
    assert.equal(proof.rows[0].total,'1');
  }finally{
    await db.query('ROLLBACK').catch(()=>{});
    await db.end();
  }
});

test('expired challenge cannot create proof or increment attempts',async()=>{
  const url=process.env.DATABASE_URL;
  if(!url) throw new Error('DATABASE_URL required for PostgreSQL integration test');
  const db=new Client({connectionString:url});
  await db.connect();
  const contactId=randomUUID(),challengeId=randomUUID();
  const digest='test-expired-'+randomUUID();
  try{
    await db.query('BEGIN');
    await db.query(`INSERT INTO guest_contacts(id,channel,encrypted_value,digest,expires_at)
      VALUES($1,'sms','encrypted-fixture',$2,now()+interval '1 day')`,[contactId,digest]);
    await db.query(`INSERT INTO guest_challenges(id,guest_contact_id,code_hash,purpose,expires_at)
      VALUES($1,$2,$3,'CREATE_REQUEST',now() + interval '10 minutes')`,
      [challengeId,contactId,'0'.repeat(64)]);
    await db.query(`UPDATE guest_challenges SET expires_at=now()-interval '1 second' WHERE id=$1`,[challengeId]);
    const p=issueGuestCapability('CREATE_REQUEST',randomBytes(32));
    const {rows}=await db.query<{verified:boolean}>(VERIFY_CREATE_REQUEST_CHALLENGE_SQL,[
      challengeId,'0'.repeat(64),randomUUID(),p.tokenHash,5,900,
    ]);
    assert.equal(rows[0].verified,false);
    const attempts=await db.query<{attempts:number}>('SELECT attempts FROM guest_challenges WHERE id=$1',[challengeId]);
    assert.equal(attempts.rows[0].attempts,0);
  }finally{
    await db.query('ROLLBACK').catch(()=>{});
    await db.end();
  }
});
