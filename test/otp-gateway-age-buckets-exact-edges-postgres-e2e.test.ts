import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {Pool} from 'pg';
import {readOtpGatewayReservationAgeBuckets} from
 '../src/platform/ingress/otp-gateway-reservation-health.reference.js';

test('OTP age-bucket edges are exact using one PostgreSQL transaction clock',
 {skip:!process.env.DATABASE_URL},async()=>{
  const suffix=randomBytes(8).toString('hex');
  const schema='otp_bucket_edges_'+suffix;
  const observer='otp_observer_edges_'+suffix;
  const admin=new Pool({connectionString:process.env.DATABASE_URL,max:1});
  let db:Pool|undefined;
  let schemaCreated=false;
  let roleCreated=false;
  try{
   await admin.query('CREATE SCHEMA '+schema);
   schemaCreated=true;
   db=new Pool({connectionString:process.env.DATABASE_URL,
    options:'-c search_path='+schema,max:1});
   await db.query(readFileSync(
    'docs/reference/otp-gateway-idempotency-ledger.sql','utf8',
   ));
   await admin.query('CREATE ROLE '+observer+' NOLOGIN');
   roleCreated=true;
   await admin.query('GRANT USAGE ON SCHEMA '+schema+' TO '+observer);
   await admin.query('GRANT SELECT(status,claimed_at) ON '+
    schema+'.otp_gateway_delivery_claims TO '+observer);
   const client=await db.connect();
   try{
    // PostgreSQL now() is stable throughout one transaction. Insert using
    // that same clock before adopting the restricted monitoring identity.
    await client.query('BEGIN');
    const fingerprint='b'.repeat(64);
    await client.query(`
      INSERT INTO otp_gateway_delivery_claims
        (idempotency_key,fingerprint,status,claimed_at)
      VALUES
        ($1,$6,'RESERVED',now()),
        ($2,$6,'RESERVED',now()-interval '5 minutes'),
        ($3,$6,'RESERVED',now()-interval '5 minutes'-interval '1 microsecond'),
        ($4,$6,'RESERVED',now()-interval '1 hour'),
        ($5,$6,'RESERVED',now()-interval '1 hour'-interval '1 microsecond')
    `,['a'.repeat(64),'c'.repeat(64),'d'.repeat(64),
       'e'.repeat(64),'f'.repeat(64),fingerprint]);
    await client.query('SET ROLE '+observer);
    assert.equal((await client.query<{current_user:string}>(
     'SELECT current_user',
    )).rows[0]?.current_user,observer);
    const buckets=await readOtpGatewayReservationAgeBuckets(
     {query:(sql:string)=>client.query(sql)} as never,
    );
    assert.deepEqual(buckets,{
     total:'5',
     underFiveMinutes:'2',
     fiveMinutesToOneHour:'2',
     oneHourOrOlder:'1',
    });
    await assert.rejects(
     client.query('SELECT idempotency_key FROM otp_gateway_delivery_claims'),
     (error:unknown)=>(error as {code?:string}).code==='42501',
    );
   }finally{
    await client.query('ROLLBACK');
    await client.query('RESET ROLE');
    client.release();
   }
  }finally{
   if(db)await db.end();
   if(roleCreated){
    await admin.query('DROP OWNED BY '+observer);
    await admin.query('DROP ROLE '+observer);
   }
   if(schemaCreated)await admin.query('DROP SCHEMA '+schema+' CASCADE');
   await admin.end();
  }
 });
