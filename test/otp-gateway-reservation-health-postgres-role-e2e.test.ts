import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {Pool} from 'pg';
import {readOtpGatewayReservationHealth} from
 '../src/platform/ingress/otp-gateway-reservation-health.reference.js';

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
   await admin.query('CREATE ROLE '+role+' NOLOGIN');
   roleCreated=true;
   await admin.query('GRANT USAGE ON SCHEMA '+schema+' TO '+role);
   await admin.query(
    'GRANT SELECT ON '+schema+'.otp_gateway_delivery_claims TO '+role,
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
    assert.equal(health.unresolvedCount,'1');
    assert.ok(health.oldestClaimedAt);
    assert.deepEqual(Object.keys(health).sort(),[
     'oldestClaimedAt','unresolvedCount',
    ]);
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
   )).rows[0]?.n,'1');
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
