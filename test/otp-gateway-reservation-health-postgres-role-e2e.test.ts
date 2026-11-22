import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {Pool} from 'pg';
import {readOtpGatewayReservationHealth,readOtpGatewayReservationAgeBuckets,
 readOtpGatewayReservationSnapshot} from
 '../src/platform/ingress/otp-gateway-reservation-health.reference.js';
import {readOtpGatewayOperatorReport} from
 '../src/platform/ingress/otp-gateway-operator-report.reference.js';

test('OTP health SELECT-only PostgreSQL role cannot mutate gateway claims',
 {skip:!process.env.DATABASE_URL},async()=>{
  const suffix=randomBytes(8).toString('hex');
  const schema='otp_health_ro_'+suffix;
  const role='otp_health_reader_'+suffix;
  const key='a'.repeat(64);
  const fingerprint='b'.repeat(64);
  const admin=new Pool({connectionString:process.env.DATABASE_URL,max:1});
  let db:Pool|undefined;
  let roleCreated=false;
  let schemaCreated=false;
  try{
   await admin.query('CREATE SCHEMA '+schema);
   schemaCreated=true;
   db=new Pool({
    connectionString:process.env.DATABASE_URL,
    options:'-c search_path='+schema,max:2,
   });
   await db.query(readFileSync(
    'docs/reference/otp-gateway-idempotency-ledger.sql','utf8',
   ));
   await db.query(
    "INSERT INTO otp_gateway_delivery_claims(idempotency_key,fingerprint,status) VALUES($1,$2,'RESERVED')",
    [key,fingerprint],
   );
   // Distinct ages are inserted by the fixture owner only; live claims
   // are immutable after reservation, and the restricted observer cannot write.
   await db.query(`
    INSERT INTO otp_gateway_delivery_claims
      (idempotency_key,fingerprint,status,claimed_at)
    VALUES
      ($1,$5,'RESERVED',now()-interval '10 minutes'),
      ($2,$5,'RESERVED',now()-interval '2 hours'),
      ($3,$5,'RESERVED',now()-interval '25 hours'),
      ($4,$5,'RESERVED',now()-interval '1 hour')
   `,['c'.repeat(64),'d'.repeat(64),'e'.repeat(64),
      'f'.repeat(64),fingerprint]);
   // A true ACCEPTED row must never be included in unresolved buckets.
   await db.query(`
    INSERT INTO otp_gateway_delivery_claims
      (idempotency_key,fingerprint,status,claimed_at)
    VALUES ($1,$2,'RESERVED',now()-interval '3 days')
   `,['9'.repeat(64),fingerprint]);
   await db.query(`
    UPDATE otp_gateway_delivery_claims
    SET status='ACCEPTED',provider_ref='provider_12345678',accepted_at=now()
    WHERE idempotency_key=$1 AND status='RESERVED'
   `,['9'.repeat(64)]);
   await admin.query('CREATE ROLE '+role+' NOLOGIN');
   roleCreated=true;
   await admin.query('GRANT USAGE ON SCHEMA '+schema+' TO '+role);
   await admin.query(
    'GRANT SELECT (status,claimed_at) ON '+schema+'.otp_gateway_delivery_claims TO '+role,
   );
   const client=await db.connect();
   try{
    await client.query('SET ROLE '+role);
    const identity=await client.query<{current_user:string}>(
     'SELECT current_user',
    );
    assert.equal(identity.rows[0]?.current_user,role);
    const health=await readOtpGatewayReservationHealth(
     {query:(sql:string)=>client.query(sql)} as never,
    );
    assert.equal(health.unresolvedCount,'5');
    assert.ok(health.oldestClaimedAt);
    assert.ok(new Date(health.oldestClaimedAt).getTime() < Date.now()-24*60*60*1000);
    const buckets=await readOtpGatewayReservationAgeBuckets(
     {query:(sql:string)=>client.query(sql)} as never,
    );
    assert.deepEqual(buckets,{
     total:'5',underFiveMinutes:'1',fiveMinutesToOneHour:'1',
     oneHourOrOlder:'3',
    });
    assert.deepEqual(Object.keys(health).sort(),[
     'oldestClaimedAt','unresolvedCount',
    ]);
    const snapshot=await readOtpGatewayReservationSnapshot(
     {query:(sql:string)=>client.query(sql)} as never,
    );
    assert.deepEqual(snapshot,{
     unresolvedCount:'5',oldestClaimedAt:health.oldestClaimedAt,
     total:'5',underFiveMinutes:'1',fiveMinutesToOneHour:'1',
     oneHourOrOlder:'3',
    });
    // The restricted observer can run the manual operator report, but the
    // schema owner cannot: broad privileges must be denied by ACL preflight.
    assert.deepEqual(
     await readOtpGatewayOperatorReport(client as never),snapshot,
    );
    await assert.rejects(
     readOtpGatewayOperatorReport(db!),
     {message:'otp_gateway_operator_report_unavailable'},
    );
    // The health reader can aggregate only allowed columns, not retrieve
    // identifiers, fingerprints or provider receipts from the ledger.
    for(const sql of [
     'SELECT idempotency_key FROM otp_gateway_delivery_claims',
     'SELECT fingerprint FROM otp_gateway_delivery_claims',
     'SELECT provider_ref FROM otp_gateway_delivery_claims',
     'SELECT accepted_at FROM otp_gateway_delivery_claims',
     'SELECT * FROM otp_gateway_delivery_claims',
    ]){
     await assert.rejects(client.query(sql),
      (error:unknown)=>(error as {code?:string}).code==='42501',sql);
    }
    // A future-dated reservation must not be reported as recent. The
    // separate test-schema owner inserts it; the observer remains SELECT-only.
    await db!.query(`
      INSERT INTO otp_gateway_delivery_claims
        (idempotency_key,fingerprint,status,claimed_at)
      VALUES ($1,$2,'RESERVED',now()+interval '2 hours')
    `,['8'.repeat(64),fingerprint]);
    await assert.rejects(
     readOtpGatewayReservationAgeBuckets(
      {query:(sql:string)=>client.query(sql)} as never,
     ),
     {message:'otp_gateway_reservation_health_unavailable'},
    );
    await assert.rejects(
     readOtpGatewayReservationSnapshot(
      {query:(sql:string)=>client.query(sql)} as never,
     ),
     {message:'otp_gateway_reservation_health_unavailable'},
    );
    for(const sql of [
     "UPDATE otp_gateway_delivery_claims SET status='ACCEPTED' WHERE idempotency_key=$1",
     'DELETE FROM otp_gateway_delivery_claims WHERE idempotency_key=$1',
     "INSERT INTO otp_gateway_delivery_claims(idempotency_key,fingerprint,status) VALUES($1,$2,'RESERVED')",
    ]){
     await assert.rejects(
      client.query(sql,sql.startsWith('INSERT')?['c'.repeat(64),fingerprint]:[key]),
      (error:unknown)=>(error as {code?:string}).code==='42501',
     );
    }
   }finally{
    await client.query('RESET ROLE');
    client.release();
   }
   const persisted=await db.query<{status:string}>(
    'SELECT status FROM otp_gateway_delivery_claims WHERE idempotency_key=$1',
    [key],
   );
   assert.deepEqual(persisted.rows.map(x=>x.status),['RESERVED']);
   assert.equal((await db.query(
    'SELECT count(*)::text AS n FROM otp_gateway_delivery_claims',
   )).rows[0]?.n,'7');
  }finally{
   if(db)await db.end();
   if(roleCreated){
    await admin.query('DROP OWNED BY '+role);
    await admin.query('DROP ROLE '+role);
   }
   if(schemaCreated)await admin.query('DROP SCHEMA '+schema+' CASCADE');
   await admin.end();
  }
 });
