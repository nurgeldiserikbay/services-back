import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {
  ACCOUNT_OTP_CHALLENGE_RETENTION,pruneAccountOtpChallenges,
} from '../src/modules/identity/account-otp-challenge-cleanup.js';

test('cleanup is bounded and uses lock skipping and expiry cutoff',async()=>{
  const queries:Array<{sql:string;args:unknown[]}>=[]; 
  const db={query:async(sql:string,args:unknown[])=>{
    queries.push({sql,args});return {rows:[{deleted_count:'2'}]};
  }} as never;
  const now=new Date('2026-11-07T10:00:00.000Z');
  assert.equal(await pruneAccountOtpChallenges(db,now),2);
  assert.match(queries[0].sql,/account_auth_challenges/);
  assert.match(queries[0].sql,/expires_at<\$1::timestamptz/);
  assert.match(queries[0].sql,/FOR UPDATE SKIP LOCKED/);
  assert.match(queries[0].sql,/LIMIT \$2::integer/);
  assert.deepEqual(queries[0].args,[
    new Date('2026-11-06T09:00:00.000Z'),
    ACCOUNT_OTP_CHALLENGE_RETENTION.batchLimit,
  ]);
  assert.equal(ACCOUNT_OTP_CHALLENGE_RETENTION.afterExpiryHours,25);
});

test('cleanup refuses invalid clocks and suspicious affected row counts',async()=>{
  let calls=0;
  const bad={query:async()=>{calls++;return {rows:[{deleted_count:'NaN'}]};}} as never;
  await assert.rejects(pruneAccountOtpChallenges(bad,new Date(NaN)));
  assert.equal(calls,0);
  await assert.rejects(pruneAccountOtpChallenges(bad));
  for(const count of [-1,ACCOUNT_OTP_CHALLENGE_RETENTION.batchLimit+1]){
    await assert.rejects(pruneAccountOtpChallenges({
      query:async()=>({rows:[{deleted_count:String(count)}]}),
    } as never));
  }
});

test('PostgreSQL cleanup deletes only sufficiently old expired OTP proofs',async()=>{
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');
  const now=new Date(),ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
  const expiryAgesHours=[26,25.1,24,0.05];
  try{
    for(let i=0;i<ids.length;i++){
      const expires=new Date(now.getTime()-expiryAgesHours[i]*3600000);
      const created=new Date(expires.getTime()-5*60000);
      await db.query(`
        INSERT INTO account_auth_challenges
          (id,channel,purpose,contact_digest,contact_cipher,code_hash,
           created_at,expires_at,delivery_confirmed_at,consumed_at)
        VALUES($1,'EMAIL'::"AuthChannel",'SIGN_IN'::"AccountAuthPurpose",
          $2,'encrypted',$3,$4,$5,$6,$7)
      `,[ids[i],randomBytes(32).toString('hex'),randomBytes(32).toString('hex'),
          created,expires,i===0||i===2?created:null,i===1?created:null]);
    }
    assert.equal(await pruneAccountOtpChallenges(db,now),2);
    const remaining=await db.query<{id:string}>(`
      SELECT id::text FROM account_auth_challenges
      WHERE id=ANY($1::uuid[])
    `,[ids]);
    assert.deepEqual(new Set(remaining.rows.map(x=>x.id)),new Set(ids.slice(2)));
    assert.equal(await pruneAccountOtpChallenges(db,now),0);
  }finally{
    await db.query('ROLLBACK').catch(()=>{});
    await db.end();
  }
});
