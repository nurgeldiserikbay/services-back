import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {GuestChallengeIssuanceService} from '../src/modules/guest-requests/guest-challenge-issuance.service.js';
import {GuestOtpDispatchService} from '../src/modules/guest-requests/guest-otp-dispatch.service.js';
import {OtpDeliveryService} from '../src/modules/guest-requests/otp-delivery.service.js';

test('failed provider revokes committed guest OTP without refunding quota (PostgreSQL)',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const previousH=process.env.GUEST_REQUEST_HMAC_KEY;
  const previousE=process.env.GUEST_CONTACT_ENCRYPTION_KEY;
  process.env.GUEST_REQUEST_HMAC_KEY=randomBytes(32).toString('base64');
  process.env.GUEST_CONTACT_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  const pool=new DatabasePool();
  const db=new Client({connectionString:process.env.DATABASE_URL});
  const contact='dispatch-'+randomBytes(9).toString('hex')+'@example.org';
  let contactId:string|undefined;
  try{
    await db.connect();
    const service=new GuestOtpDispatchService(
      new GuestChallengeIssuanceService(pool),new OtpDeliveryService(),pool);
    await assert.rejects(service.dispatchCreateRequest('email',contact,'kk'),
      /OTP temporarily unavailable/);
    const {rows}=await db.query<{id:string;consumed_at:Date|null;guest_contact_id:string}>(
      `SELECT ch.id,ch.consumed_at,ch.guest_contact_id
       FROM guest_challenges ch JOIN guest_contacts c ON c.id=ch.guest_contact_id
       WHERE c.channel='email' AND c.digest=$1`,
      ['no-match']);
    assert.equal(rows.length,0);
    // Query by decrypted-contact suffix cannot use PII; use a
    // unique fixture's encrypted_value from the issued contact.
    const result=await db.query<{id:string;consumed_at:Date|null;guest_contact_id:string}>(
      `SELECT ch.id,ch.consumed_at,ch.guest_contact_id
       FROM guest_challenges ch JOIN guest_contacts c ON c.id=ch.guest_contact_id
       WHERE c.digest=$1`,
      [
        (await import('../src/modules/guest-requests/guest-request.security.js'))
          .contactDigest('email',contact,Buffer.from(process.env.GUEST_REQUEST_HMAC_KEY!,'base64')),
      ]);
    assert.equal(result.rowCount,1);
    contactId=result.rows[0].guest_contact_id;
    assert.ok(result.rows[0].consumed_at instanceof Date);
    // A failed attempt cannot immediately obtain a fresh OTP.
    await assert.rejects(service.dispatchCreateRequest('email',contact,'kk'));
  }finally{
    if(contactId){
      await db.query('DELETE FROM guest_challenges WHERE guest_contact_id=$1',[contactId]);
      await db.query('DELETE FROM guest_contacts WHERE id=$1',[contactId]);
    }
    await db.end().catch(()=>{});
    await pool.onModuleDestroy();
    if(previousH===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
    else process.env.GUEST_REQUEST_HMAC_KEY=previousH;
    if(previousE===undefined)delete process.env.GUEST_CONTACT_ENCRYPTION_KEY;
    else process.env.GUEST_CONTACT_ENCRYPTION_KEY=previousE;
  }
});
