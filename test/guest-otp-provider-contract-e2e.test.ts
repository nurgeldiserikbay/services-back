import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {GuestChallengeIssuanceService}
  from '../src/modules/guest-requests/guest-challenge-issuance.service.js';
import {GuestOtpDispatchService}
  from '../src/modules/guest-requests/guest-otp-dispatch.service.js';
import {GuestChallengeProofRepository}
  from '../src/modules/guest-requests/guest-challenge-proof.repository.js';
import {GuestChallengeVerificationService}
  from '../src/modules/guest-requests/guest-challenge-verification.service.js';
import {OtpDeliveryService}
  from '../src/modules/guest-requests/otp-delivery.service.js';
import type {OtpDeliveryMessage,OtpDeliveryPort}
  from '../src/modules/guest-requests/otp-delivery.port.js';
import {contactDigest,hashGuestCapability}
  from '../src/modules/guest-requests/guest-request.security.js';

test('PostgreSQL OTP provider contract: committed send -> verify -> single-use proof',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const previousH=process.env.GUEST_REQUEST_HMAC_KEY;
  const previousE=process.env.GUEST_CONTACT_ENCRYPTION_KEY;
  const pepper=randomBytes(32),encryptionKey=randomBytes(32);
  process.env.GUEST_REQUEST_HMAC_KEY=pepper.toString('base64');
  process.env.GUEST_CONTACT_ENCRYPTION_KEY=encryptionKey.toString('base64');
  const pool=new DatabasePool();
  const db=new Client({connectionString:process.env.DATABASE_URL});
  const contact='contract-'+randomBytes(9).toString('hex')+'@example.org';
  const networkDigest=randomBytes(32).toString('hex');
  let guestContactId:string|undefined;
  let delivered:OtpDeliveryMessage|undefined;
  let deliveries=0;
  const provider:OtpDeliveryPort={
    async deliverOtp(message){
      deliveries++;
      delivered=message;
      return {accepted:true,providerRef:'test_accept_000001'};
    },
  };
  try{
    await db.connect();
    const dispatch=new GuestOtpDispatchService(
      new GuestChallengeIssuanceService(pool),
      new OtpDeliveryService(provider),pool,
    );
    const verify=new GuestChallengeVerificationService(
      new GuestChallengeProofRepository(pool),
    );
    const sent=await dispatch.dispatchCreateRequest(
      'email',contact,'kk',networkDigest,
    );
    assert.match(sent.challengeId,/^[a-f0-9-]{36}$/i);
    assert.equal(sent.expiresInSeconds,600);
    assert.equal(deliveries,1);
    assert.ok(delivered);
    assert.equal(delivered?.destination,contact);
    assert.equal(delivered?.purpose,'CREATE_REQUEST');
    assert.equal(delivered?.locale,'kk');
    assert.equal(delivered?.expiresInSeconds,600);
    assert.match(delivered?.code??'',/^[0-9]{6}$/);

    const stored=await db.query<{
      guest_contact_id:string;encrypted_value:string;code_hash:string;
      consumed_at:Date|null;attempts:number;
    }>(`
      SELECT ch.guest_contact_id,c.encrypted_value,ch.code_hash,
             ch.consumed_at,ch.attempts
      FROM guest_challenges ch
      JOIN guest_contacts c ON c.id=ch.guest_contact_id
      WHERE ch.id=$1::uuid
    `,[sent.challengeId]);
    assert.equal(stored.rowCount,1);
    guestContactId=stored.rows[0].guest_contact_id;
    assert.notEqual(stored.rows[0].encrypted_value,contact);
    assert.notEqual(stored.rows[0].code_hash,delivered?.code);
    assert.equal(stored.rows[0].consumed_at,null);
    assert.equal(stored.rows[0].attempts,0);

    const charged=await db.query<{n:string}>(`
      SELECT count(*)::text n FROM guest_otp_network_issuances
      WHERE network_digest=$1
    `,[networkDigest]);
    assert.equal(charged.rows[0].n,'1');

    // Wrong code charges an attempt and cannot grant a capability.
    const wrong=delivered!.code==='999999'?'999998':'999999';
    await assert.rejects(
      verify.verifyCreateRequest(sent.challengeId,wrong),
      /Invalid or expired verification code/,
    );
    const failed=await db.query<{attempts:number}>(`
      SELECT attempts FROM guest_challenges WHERE id=$1::uuid
    `,[sent.challengeId]);
    assert.equal(failed.rows[0].attempts,1);

    const verified=await verify.verifyCreateRequest(sent.challengeId,delivered!.code);
    assert.match(verified.guestCapability,/^[A-Za-z0-9_-]{43}$/);
    assert.equal(verified.expiresInSeconds,900);
    const caps=await db.query<{scope:string;token_hash:string;request_id:string|null}>(`
      SELECT scope::text,token_hash,request_id::text
      FROM guest_capabilities WHERE guest_contact_id=$1::uuid
    `,[guestContactId]);
    assert.equal(caps.rowCount,1);
    assert.equal(caps.rows[0].scope,'CREATE_REQUEST');
    assert.equal(caps.rows[0].request_id,null);
    assert.equal(caps.rows[0].token_hash,
      hashGuestCapability('CREATE_REQUEST',verified.guestCapability,pepper));

    // A consumed OTP must never produce a second CREATE_REQUEST token.
    await assert.rejects(
      verify.verifyCreateRequest(sent.challengeId,delivered!.code),
      /Invalid or expired verification code/,
    );
    await assert.rejects(
      dispatch.dispatchCreateRequest('email',contact,'kk',networkDigest),
      /Guest OTP temporarily unavailable/,
    );
    assert.equal(deliveries,1);
    const after=await db.query<{n:string}>(`
      SELECT count(*)::text n FROM guest_capabilities
      WHERE guest_contact_id=$1::uuid
    `,[guestContactId]);
    assert.equal(after.rows[0].n,'1');
  }finally{
    // Purge only the fixture's keyed test rows. No fixtures or secrets remain.
    if(guestContactId){
      await db.query('DELETE FROM guest_capabilities WHERE guest_contact_id=$1::uuid',
        [guestContactId]).catch(()=>{});
      await db.query('DELETE FROM guest_challenges WHERE guest_contact_id=$1::uuid',
        [guestContactId]).catch(()=>{});
      await db.query('DELETE FROM guest_contacts WHERE id=$1::uuid',
        [guestContactId]).catch(()=>{});
    }
    await db.query('DELETE FROM guest_otp_network_issuances WHERE network_digest=$1',
      [networkDigest]).catch(()=>{});
    await db.end().catch(()=>{});
    await pool.onModuleDestroy();
    if(previousH===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
    else process.env.GUEST_REQUEST_HMAC_KEY=previousH;
    if(previousE===undefined)delete process.env.GUEST_CONTACT_ENCRYPTION_KEY;
    else process.env.GUEST_CONTACT_ENCRYPTION_KEY=previousE;
  }
});

test('provider rejection never reports a successful OTP and consumes challenge',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const prevH=process.env.GUEST_REQUEST_HMAC_KEY;
  const prevE=process.env.GUEST_CONTACT_ENCRYPTION_KEY;
  const pepper=randomBytes(32);
  process.env.GUEST_REQUEST_HMAC_KEY=pepper.toString('base64');
  process.env.GUEST_CONTACT_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  const pool=new DatabasePool();
  const db=new Client({connectionString:process.env.DATABASE_URL});
  const contact='rejected-'+randomBytes(9).toString('hex')+'@example.org';
  const networkDigest=randomBytes(32).toString('hex');
  let contactId:string|undefined;
  try{
    await db.connect();
    const provider:OtpDeliveryPort={
      async deliverOtp(){return {accepted:false,providerRef:'reject_000001'};},
    };
    const dispatch=new GuestOtpDispatchService(
      new GuestChallengeIssuanceService(pool),new OtpDeliveryService(provider),pool,
    );
    await assert.rejects(
      dispatch.dispatchCreateRequest('email',contact,'ru',networkDigest),
      /OTP temporarily unavailable/,
    );
    const digest=contactDigest('email',contact,pepper);
    const records=await db.query<{guest_contact_id:string;consumed_at:Date|null}>(`
      SELECT ch.guest_contact_id,ch.consumed_at
      FROM guest_challenges ch JOIN guest_contacts c ON c.id=ch.guest_contact_id
      WHERE c.digest=$1
    `,[digest]);
    assert.equal(records.rowCount,1);
    contactId=records.rows[0].guest_contact_id;
    assert.ok(records.rows[0].consumed_at instanceof Date);
    const charged=await db.query<{n:string}>(`
      SELECT count(*)::text n FROM guest_otp_network_issuances
      WHERE network_digest=$1
    `,[networkDigest]);
    assert.equal(charged.rows[0].n,'1');
  }finally{
    if(contactId){
      await db.query('DELETE FROM guest_challenges WHERE guest_contact_id=$1::uuid',
        [contactId]).catch(()=>{});
      await db.query('DELETE FROM guest_contacts WHERE id=$1::uuid',
        [contactId]).catch(()=>{});
    }
    await db.query('DELETE FROM guest_otp_network_issuances WHERE network_digest=$1',
      [networkDigest]).catch(()=>{});
    await db.end().catch(()=>{});
    await pool.onModuleDestroy();
    if(prevH===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
    else process.env.GUEST_REQUEST_HMAC_KEY=prevH;
    if(prevE===undefined)delete process.env.GUEST_CONTACT_ENCRYPTION_KEY;
    else process.env.GUEST_CONTACT_ENCRYPTION_KEY=prevE;
  }
});
