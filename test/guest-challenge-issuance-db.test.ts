import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {GuestChallengeIssuanceService,GuestOtpSendLimited}
  from '../src/modules/guest-requests/guest-challenge-issuance.service.js';
import {decryptGuestContact,hashOtp} from '../src/modules/guest-requests/guest-request.security.js';

test('issues encrypted, hashed and quota-limited OTP atomically in PostgreSQL',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const hmac=randomBytes(32),enc=randomBytes(32);
  const oldH=process.env.GUEST_REQUEST_HMAC_KEY;
  const oldE=process.env.GUEST_CONTACT_ENCRYPTION_KEY;
  process.env.GUEST_REQUEST_HMAC_KEY=hmac.toString('base64');
  process.env.GUEST_CONTACT_ENCRYPTION_KEY=enc.toString('base64');
  const db=new Client({connectionString:process.env.DATABASE_URL});
  const pool=new DatabasePool();
  const service=new GuestChallengeIssuanceService(pool);
  const contact='otp-'+randomBytes(9).toString('hex')+'@example.org';
  let contactId:string|undefined;
  try{
    await db.connect();
    const issued=await service.issueCreateRequest('email',contact);
    assert.match(issued.code,/^[0-9]{6}$/);
    assert.equal(issued.contact,contact);
    assert.equal(issued.expiresInSeconds,600);
    const stored=await db.query<{
      guest_contact_id:string;encrypted_value:string;digest:string;code_hash:string;
    }>(`SELECT ch.guest_contact_id,c.encrypted_value,c.digest,ch.code_hash
      FROM guest_challenges ch JOIN guest_contacts c ON c.id=ch.guest_contact_id
      WHERE ch.id=$1`,[issued.challengeId]);
    assert.equal(stored.rowCount,1);
    contactId=stored.rows[0].guest_contact_id;
    assert.equal(decryptGuestContact(stored.rows[0].encrypted_value,enc),contact);
    assert.notEqual(stored.rows[0].digest,contact);
    assert.equal(stored.rows[0].code_hash,hashOtp(issued.challengeId,issued.code,hmac));
    await assert.rejects(service.issueCreateRequest('email',contact),
      (e:unknown)=>e instanceof GuestOtpSendLimited && e.reason==='cooldown');

    const count=await db.query<{n:string}>(`SELECT count(*)::text n FROM
      guest_challenges ch JOIN guest_contacts c ON c.id=ch.guest_contact_id
      WHERE c.digest=$1`,[stored.rows[0].digest]);
    assert.equal(count.rows[0].n,'1');
  }finally{
    if(contactId){
      await db.query('DELETE FROM guest_challenges WHERE guest_contact_id=$1',[contactId]);
      await db.query('DELETE FROM guest_contacts WHERE id=$1',[contactId]);
    }
    await db.end().catch(()=>{});
    await pool.onModuleDestroy();
    if(oldH===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
    else process.env.GUEST_REQUEST_HMAC_KEY=oldH;
    if(oldE===undefined)delete process.env.GUEST_CONTACT_ENCRYPTION_KEY;
    else process.env.GUEST_CONTACT_ENCRYPTION_KEY=oldE;
  }
});

test('invalid contact or missing distinct secrets does not query database',async()=>{
  const db={transaction:async()=>{throw new Error('must not query')}} as unknown as DatabasePool;
  const service=new GuestChallengeIssuanceService(db);
  await assert.rejects(service.issueCreateRequest('email','invalid-contact'),/Guest OTP temporarily unavailable/);
  const oldH=process.env.GUEST_REQUEST_HMAC_KEY;
  const oldE=process.env.GUEST_CONTACT_ENCRYPTION_KEY;
  try{
    const same=randomBytes(32).toString('base64');
    process.env.GUEST_REQUEST_HMAC_KEY=same;
    process.env.GUEST_CONTACT_ENCRYPTION_KEY=same;
    await assert.rejects(service.issueCreateRequest('email','valid@example.org'),/Guest OTP temporarily unavailable/);
  }finally{
    if(oldH===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
    else process.env.GUEST_REQUEST_HMAC_KEY=oldH;
    if(oldE===undefined)delete process.env.GUEST_CONTACT_ENCRYPTION_KEY;
    else process.env.GUEST_CONTACT_ENCRYPTION_KEY=oldE;
  }
});
