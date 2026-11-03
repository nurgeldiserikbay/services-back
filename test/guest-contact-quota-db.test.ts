import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {checkContactSendQuota,SEND_QUOTA} from '../src/modules/guest-requests/guest-contact-quota.js';

test('recipient send budget limits repeated challenges without raw PII',async()=>{
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');
  const contactId=randomUUID(),digest=randomBytes(32).toString('hex');
  try{
    await db.query(`INSERT INTO guest_contacts
      (id,channel,encrypted_value,digest,expires_at)
      VALUES($1,'sms','encrypted-fixture',$2,now()+interval '2 days')`,[contactId,digest]);
    const at=new Date();
    const empty=await checkContactSendQuota(db,digest,at);
    assert.equal(empty.allowed,true);
    await db.query(`INSERT INTO guest_challenges
      (id,guest_contact_id,code_hash,purpose,expires_at,created_at)
      VALUES($1,$2,$3,'CREATE_REQUEST',now()+interval '10 minutes',$4)`,
      [randomUUID(),contactId,'a'.repeat(64),at]);
    const cooldown=await checkContactSendQuota(db,digest,new Date(at.getTime()+5000));
    assert.equal(cooldown.reason,'cooldown');
    for(let i=1;i<SEND_QUOTA.perHour;i++){
      await db.query(`INSERT INTO guest_challenges
        (id,guest_contact_id,code_hash,purpose,expires_at,created_at)
        VALUES($1,$2,$3,'CREATE_REQUEST',now()+interval '10 minutes',$4)`,
        [randomUUID(),contactId,'a'.repeat(64),new Date(at.getTime()-i*2*60_000)]);
    }
    const limited=await checkContactSendQuota(db,digest,new Date(at.getTime()+70_000));
    assert.equal(limited.reason,'hourly');
    assert.equal(limited.allowed,false);
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('invalid digest and invalid budget inputs fail before DB call',async()=>{
  const fake={query:async()=>{throw new Error('unexpected_query')}} as never;
  await assert.rejects(checkContactSendQuota(fake,'phone@example.com'),/invalid_digest/);
  await assert.rejects(checkContactSendQuota(fake,'a'.repeat(64),new Date(NaN)),/invalid_time/);
});
