import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {issueAccountOtpChallenge,AccountOtpIssuanceUnavailable}
 from '../src/modules/identity/account-otp-issuance.js';
import {hashAccountOtp,verifyAccountOtp} from '../src/modules/identity/account-otp-proof.js';
import {
  DisabledAccountOtpDelivery,AccountOtpDeliveryUnavailable,
  sanitizeAccountOtpReceipt,
} from '../src/modules/identity/account-otp-delivery.port.js';

const secret=()=>({otpPepper:randomBytes(32),
 contactPepper:randomBytes(32),contactKey:randomBytes(32)});
async function openDb(){
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');return db;
}
test('private account issuance stores hashed OTP, encrypted contact and 5-minute expiry',async()=>{
 const db=await openDb(),keys=secret();
 try{
  const issued=await issueAccountOtpChallenge(db,{
   channel:'EMAIL',purpose:'SIGN_IN',contact:'Person@example.com',
  },keys);
  assert.match(issued.code,/^[0-9]{6}$/);
  assert.equal(issued.destination,'Person@example.com');
  assert.equal(issued.expiresInSeconds,300);
  const response=await db.query<{
    contact_digest:string;contact_cipher:string;code_hash:string;
    channel:string;purpose:string;expires_at:Date;created_at:Date;
  }>('SELECT * FROM account_auth_challenges WHERE id=$1',[issued.challengeId]);
  const row=response.rows[0];
  assert.equal(row.channel,'EMAIL');
  assert.equal(row.purpose,'SIGN_IN');
  assert.equal(row.contact_cipher.includes('Person@example.com'),false);
  assert.equal(row.contact_digest.includes('Person@example.com'),false);
  assert.notEqual(row.code_hash,issued.code);
  assert.equal(row.code_hash,hashAccountOtp(issued.challengeId,'SIGN_IN',issued.code,keys.otpPepper));
  assert.equal(verifyAccountOtp(issued.challengeId,'SIGN_IN',issued.code,row.code_hash,keys.otpPepper),true);
  const delta=row.expires_at.getTime()-row.created_at.getTime();
  assert.ok(delta>=299000&&delta<=301000);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
test('contact quota rejects immediate reissue without writing another challenge',async()=>{
 const db=await openDb(),keys=secret();
 try{
  const input={channel:'SMS' as const,purpose:'SIGN_UP' as const,contact:'+77011234567'};
  const one=await issueAccountOtpChallenge(db,input,keys);
  await assert.rejects(issueAccountOtpChallenge(db,input,keys),AccountOtpIssuanceUnavailable);
  const count=await db.query<{total:string}>(
   'SELECT count(*)::text AS total FROM account_auth_challenges WHERE id=$1',[one.challengeId]);
  assert.equal(count.rows[0].total,'1');
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
test('different purpose is still scoped to same contact quota and secrets are separate',async()=>{
 const db=await openDb(),keys=secret();
 try{
  const input={channel:'EMAIL' as const,purpose:'SIGN_IN' as const,contact:'someone@example.com'};
  await issueAccountOtpChallenge(db,input,keys);
  await assert.rejects(issueAccountOtpChallenge(db,{...input,purpose:'SIGN_UP'},keys),
    AccountOtpIssuanceUnavailable);
  const reused={...keys,contactPepper:keys.otpPepper};
  await assert.rejects(issueAccountOtpChallenge(db,{
   channel:'EMAIL',purpose:'SIGN_IN',contact:'other@example.com',
  },reused),AccountOtpIssuanceUnavailable);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
test('account delivery is disabled until an approved provider is configured',async()=>{
 const disabled=new DisabledAccountOtpDelivery();
 await assert.rejects(disabled.deliver({
  challengeId:'00000000-0000-4000-8000-000000000000',channel:'EMAIL',
  purpose:'SIGN_IN',destination:'someone@example.com',code:'123456',
  expiresInSeconds:300,locale:'kk',
 }),AccountOtpDeliveryUnavailable);
 assert.deepEqual(sanitizeAccountOtpReceipt({accepted:true,providerRef:'reference_123'}),
   {accepted:true,providerRef:'reference_123'});
 assert.throws(()=>sanitizeAccountOtpReceipt({accepted:true,providerRef:'contact@example.com'}));
});
