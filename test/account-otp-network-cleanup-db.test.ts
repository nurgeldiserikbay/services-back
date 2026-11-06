import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {
  ACCOUNT_OTP_NETWORK_RETENTION,pruneAccountOtpNetworkLedger,
} from '../src/modules/identity/account-otp-network-cleanup.js';

test('account network cleanup uses bounded SKIP LOCKED and 25-hour cutoff',async()=>{
  const sql:string[]=[];
  const values:unknown[][]=[];
  const db={query:async(query:string,args:unknown[])=>{
    sql.push(query);values.push(args);return {rows:[{deleted_count:'2'}]};
  }} as never;
  const now=new Date('2026-11-06T10:00:00.000Z');
  assert.equal(await pruneAccountOtpNetworkLedger(db,now),2);
  assert.match(sql[0],/account_otp_network_issuances/);
  assert.match(sql[0],/FOR UPDATE SKIP LOCKED/);
  assert.match(sql[0],/ORDER BY created_at,id/);
  assert.match(sql[0],/LIMIT \$2::integer/);
  assert.deepEqual(values[0],[
    new Date('2026-11-05T09:00:00.000Z'),
    ACCOUNT_OTP_NETWORK_RETENTION.batchLimit,
  ]);
  assert.equal(ACCOUNT_OTP_NETWORK_RETENTION.minimumHours,25);
});

test('account network cleanup fails closed on invalid clocks and counts',async()=>{
  let calls=0;
  const broken={query:async()=>{calls++;return {rows:[{deleted_count:'bad'}]};}} as never;
  await assert.rejects(pruneAccountOtpNetworkLedger(broken,new Date(NaN)));
  assert.equal(calls,0);
  await assert.rejects(pruneAccountOtpNetworkLedger(broken));
  const excessive={query:async()=>({rows:[{
    deleted_count:String(ACCOUNT_OTP_NETWORK_RETENTION.batchLimit+1),
  }]})} as never;
  await assert.rejects(pruneAccountOtpNetworkLedger(excessive));
});

test('PostgreSQL cleanup deletes old account network rows, retaining recent rows',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const db=new Client({connectionString:process.env.DATABASE_URL});
  const oldDigest=randomBytes(32).toString('hex');
  const liveDigest=randomBytes(32).toString('hex');
  await db.connect();await db.query('BEGIN');
  try{
    const now=new Date();
    const stamps=[
      [oldDigest,new Date(now.getTime()-26*3600000)],
      [oldDigest,new Date(now.getTime()-26*3600000)],
      [liveDigest,new Date(now.getTime()-24.5*3600000)],
      [liveDigest,new Date(now.getTime()-23*3600000)],
    ] as const;
    for(const [digest,created] of stamps){
      await db.query(`
        INSERT INTO account_otp_network_issuances
          (id,network_digest,created_at)
        VALUES($1::uuid,$2,$3::timestamptz)
      `,[randomUUID(),digest,created]);
    }
    assert.equal(await pruneAccountOtpNetworkLedger(db,now),2);
    const result=await db.query<{network_digest:string}>(`
      SELECT network_digest FROM account_otp_network_issuances
      WHERE network_digest=ANY($1::varchar[])
      ORDER BY created_at
    `,[[oldDigest,liveDigest]]);
    assert.deepEqual(result.rows.map(row=>row.network_digest),
      [liveDigest,liveDigest]);
    assert.equal(await pruneAccountOtpNetworkLedger(db,now),0);
  }finally{
    await db.query('ROLLBACK').catch(()=>{});
    await db.end();
  }
});
