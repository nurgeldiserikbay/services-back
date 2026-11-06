import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {checkAccountOtpGlobalBudget,ACCOUNT_OTP_GLOBAL_BUDGET}
 from '../src/modules/identity/account-otp-global-budget.js';
import {issueAccountOtpChallenge,AccountOtpIssuanceUnavailable}
 from '../src/modules/identity/account-otp-issuance.js';

async function openDb(){
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');return db;
}
async function seed(db:Client,created:string,channel:'EMAIL'|'SMS'='EMAIL',
 purpose:'SIGN_IN'|'SIGN_UP'='SIGN_IN'){
 const id=randomUUID();
 await db.query(`
  INSERT INTO account_auth_challenges
    (id,channel,purpose,contact_digest,contact_cipher,code_hash,
     created_at,expires_at)
  VALUES($1,$2::"AuthChannel",$3::"AccountAuthPurpose",$4,$5,$6,
         now()-($7::integer*interval '1 second'),
         now()-($7::integer*interval '1 second')+interval '5 minutes')
 `,[id,channel,purpose,randomBytes(32).toString('hex'),
   'test-cipher',randomBytes(32).toString('hex'),Number(created)]);
}
test('global quota counts both signup and signin and blocks 30 per minute',async()=>{
 const db=await openDb();
 try{
  assert.equal((await checkAccountOtpGlobalBudget(db)).allowed,true);
  for(let i=0;i<ACCOUNT_OTP_GLOBAL_BUDGET.perMinute;i++)
   await seed(db,'0',i%2===0?'EMAIL':'SMS',
     i%2===0?'SIGN_IN':'SIGN_UP');
  const result=await checkAccountOtpGlobalBudget(db);
  assert.deepEqual(result,{allowed:false,retryAfterSeconds:60,reason:'global_minute'});
  const before=await db.query<{total:string}>(
    'SELECT count(*)::text AS total FROM account_auth_challenges',[]);
  const keys={otpPepper:randomBytes(32),contactPepper:randomBytes(32),
    contactKey:randomBytes(32)};
  await assert.rejects(issueAccountOtpChallenge(db,{
    channel:'EMAIL',purpose:'SIGN_IN',contact:'test@example.com',
  },keys),AccountOtpIssuanceUnavailable);
  const after=await db.query<{total:string}>(
    'SELECT count(*)::text AS total FROM account_auth_challenges',[]);
  assert.equal(after.rows[0].total,before.rows[0].total);
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
test('global hourly cap cannot be bypassed with old minute entries',async()=>{
 const db=await openDb();
 try{
  for(let i=0;i<ACCOUNT_OTP_GLOBAL_BUDGET.perHour;i++)
   await seed(db,'120',i%2===0?'EMAIL':'SMS',
     i%2===0?'SIGN_IN':'SIGN_UP');
  assert.deepEqual(await checkAccountOtpGlobalBudget(db),
   {allowed:false,retryAfterSeconds:3600,reason:'global_hour'});
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
test('global daily cap counts older consumed, expired OTP challenges',async()=>{
 const db=await openDb();
 try{
  // One INSERT statement is used to avoid test-run timeouts at the 3000/day ceiling.
  await db.query(`
    INSERT INTO account_auth_challenges
      (id,channel,purpose,contact_digest,contact_cipher,code_hash,
       created_at,expires_at)
    SELECT ('00000000-0000-4000-8000-'||
      lpad(to_hex(n),12,'0'))::uuid,
      CASE WHEN n%2=0 THEN 'SIGN_IN'::"AccountAuthPurpose"
        ELSE 'SIGN_UP'::"AccountAuthPurpose" END::"AccountAuthPurpose",
      'SIGN_IN'::"AccountAuthPurpose",
      lpad(to_hex(n),64,'0'),
      'test-cipher',repeat('a',64),
      now()-interval '2 hours',now()-interval '115 minutes'
    FROM generate_series(1,$1::integer) AS n
  `,[ACCOUNT_OTP_GLOBAL_BUDGET.perDay]);
 }catch(error){
  await db.query('ROLLBACK').catch(()=>{});await db.end();
  throw error;
 }
 try{
  assert.deepEqual(await checkAccountOtpGlobalBudget(db),
   {allowed:false,retryAfterSeconds:86400,reason:'global_day'});
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
