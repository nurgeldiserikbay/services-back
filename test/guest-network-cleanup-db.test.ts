import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {NETWORK_RETENTION,pruneGuestOtpNetworkLedger}
  from '../src/modules/guest-requests/guest-network-cleanup.js';

test('pruning uses a bounded SKIP LOCKED statement with a 25h cutoff',async()=>{
  const statements:string[]=[];
  const args:unknown[][]=[];
  const client={query:async(sql:string,values:unknown[])=>{
    statements.push(sql);args.push(values);
    return {rows:[{deleted_count:'2'}]};
  }} as never;
  const now=new Date('2026-11-04T12:00:00.000Z');
  assert.equal(await pruneGuestOtpNetworkLedger(client,now),2);
  assert.match(statements[0],/FOR UPDATE SKIP LOCKED/);
  assert.match(statements[0],/LIMIT \$2::integer/);
  assert.match(statements[0],/ORDER BY created_at,id/);
  assert.deepEqual(args[0],[
    new Date('2026-11-03T11:00:00.000Z'),NETWORK_RETENTION.batchLimit,
  ]);
  assert.equal(NETWORK_RETENTION.minimumHours,25);
});

test('invalid clock and unexpected counts fail closed',async()=>{
  let calls=0;
  const invalid={query:async()=>{calls++;return {rows:[{deleted_count:'bad'}]};}} as never;
  await assert.rejects(pruneGuestOtpNetworkLedger(invalid,new Date(NaN)));
  assert.equal(calls,0);
  await assert.rejects(pruneGuestOtpNetworkLedger(invalid));
  const overflow={query:async()=>({
    rows:[{deleted_count:String(NETWORK_RETENTION.batchLimit+1)}],
  })} as never;
  await assert.rejects(pruneGuestOtpNetworkLedger(overflow));
});

test('real PostgreSQL pruning keeps active 24h rows and deletes old rows in batches',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const db=new Client({connectionString:process.env.DATABASE_URL});
  const oldDigest=randomBytes(32).toString('hex');
  const currentDigest=randomBytes(32).toString('hex');
  await db.connect();
  await db.query('BEGIN');
  try{
    const now=new Date();
    const oldAt=new Date(now.getTime()-26*3600000);
    const boundaryAt=new Date(now.getTime()-24.5*3600000);
    const liveAt=new Date(now.getTime()-23*3600000);
    for(const [digest,created] of [
      [oldDigest,oldAt],[oldDigest,oldAt],
      [currentDigest,boundaryAt],[currentDigest,liveAt],
    ] as const){
      await db.query(`
        INSERT INTO guest_otp_network_issuances
          (id,network_digest,purpose,created_at)
        VALUES($1::uuid,$2,'CREATE_REQUEST',$3::timestamptz)
      `,[randomUUID(),digest,created]);
    }
    assert.equal(await pruneGuestOtpNetworkLedger(db,now),2);
    const result=await db.query<{network_digest:string}>(`
      SELECT network_digest FROM guest_otp_network_issuances
      WHERE network_digest=ANY($1::varchar[])
      ORDER BY created_at
    `,[[oldDigest,currentDigest]]);
    assert.deepEqual(result.rows.map(x=>x.network_digest),
      [currentDigest,currentDigest]);
    assert.equal(await pruneGuestOtpNetworkLedger(db,now),0);
  }finally{
    await db.query('ROLLBACK').catch(()=>{});
    await db.end();
  }
});
