import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {
 generateAccountOtp,hashAccountOtp,verifyAccountOtp,ACCOUNT_OTP_MAX_ATTEMPTS,
} from '../src/modules/identity/account-otp-proof.js';
import {consumeAccountOtpChallenge}
 from '../src/modules/identity/account-otp-verification.js';

test('account OTP is purpose/challenge bound and distinct from guest scheme',()=>{
 const pepper=randomBytes(32),id=randomUUID(),other=randomUUID();
 const {code,codeHash}=generateAccountOtp(id,'SIGN_IN',pepper);
 assert.match(code,/^[0-9]{6}$/);
 assert.equal(verifyAccountOtp(id,'SIGN_IN',code,codeHash,pepper),true);
 assert.equal(verifyAccountOtp(id,'SIGN_UP',code,codeHash,pepper),false);
 assert.equal(verifyAccountOtp(other,'SIGN_IN',code,codeHash,pepper),false);
 assert.equal(verifyAccountOtp(id,'SIGN_IN','wrong',codeHash,pepper),false);
 assert.notEqual(codeHash,code);
 assert.equal(hashAccountOtp(id,'SIGN_IN',code,pepper),codeHash);
 assert.throws(()=>generateAccountOtp(id,'SIGN_IN',randomBytes(16)));
});

async function openDb(){
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 return db;
}
async function insertChallenge(db:Client,pepper:Buffer,purpose:'SIGN_IN'|'SIGN_UP'='SIGN_IN'){
 const id=randomUUID(),code='012345',contactDigest=randomBytes(32).toString('hex');
 await db.query(`
   INSERT INTO account_auth_challenges
     (id,channel,purpose,contact_digest,contact_cipher,code_hash,expires_at)
   VALUES($1,'EMAIL'::"AuthChannel",$2::"AccountAuthPurpose",$3,'test-cipher',$4,
     now()+interval '5 minutes')
 `,[id,purpose,contactDigest,hashAccountOtp(id,purpose,code,pepper)]);
 return {id,code,contactDigest};
}
test('successful account OTP is consumed once; wrong purpose cannot spend it',async()=>{
 const db=await openDb(),pepper=randomBytes(32);
 try{
  const {id,code,contactDigest}=await insertChallenge(db,pepper);
  assert.equal(await consumeAccountOtpChallenge(db,id,'SIGN_UP','EMAIL',code,pepper),null);
  const verified=await consumeAccountOtpChallenge(db,id,'SIGN_IN','EMAIL',code,pepper);
  assert.deepEqual(verified,{challengeId:id,channel:'EMAIL',purpose:'SIGN_IN',contactDigest});
  assert.equal(await consumeAccountOtpChallenge(db,id,'SIGN_IN','EMAIL',code,pepper),null);
  const count=await db.query<{attempts:number;consumed_at:Date|null}>(
    'SELECT attempts,consumed_at FROM account_auth_challenges WHERE id=$1',[id]);
  assert.equal(count.rows[0].attempts,1);
  assert.ok(count.rows[0].consumed_at);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});

test('five wrong codes consume attempt budget without producing verification',async()=>{
 const db=await openDb(),pepper=randomBytes(32);
 try{
  const {id,code}=await insertChallenge(db,pepper);
  for(let i=0;i<ACCOUNT_OTP_MAX_ATTEMPTS;i++)
    assert.equal(await consumeAccountOtpChallenge(db,id,'SIGN_IN','EMAIL','999999',pepper),null);
  assert.equal(await consumeAccountOtpChallenge(db,id,'SIGN_IN','EMAIL',code,pepper),null);
  const row=await db.query<{attempts:number;consumed_at:Date|null}>(
    'SELECT attempts,consumed_at FROM account_auth_challenges WHERE id=$1',[id]);
  assert.equal(row.rows[0].attempts,5);
  assert.equal(row.rows[0].consumed_at,null);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
test('expired and missing challenges fail without mutation',async()=>{
 const db=await openDb(),pepper=randomBytes(32);
 try{
  const {id,code}=await insertChallenge(db,pepper);
  await db.query("UPDATE account_auth_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[id]);
  assert.equal(await consumeAccountOtpChallenge(db,id,'SIGN_IN','EMAIL',code,pepper),null);
  assert.equal(await consumeAccountOtpChallenge(db,randomUUID(),'SIGN_IN','EMAIL',code,pepper),null);
  assert.equal(await consumeAccountOtpChallenge(db,'invalid','SIGN_IN','EMAIL',code,pepper),null);
  const attempts=await db.query<{attempts:number}>(
    'SELECT attempts FROM account_auth_challenges WHERE id=$1',[id]);
  assert.equal(attempts.rows[0].attempts,0);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
