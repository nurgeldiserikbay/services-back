import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {Pool} from 'pg';
import {OtpGatewayPostgresLedger} from
 '../src/platform/ingress/otp-gateway-postgres-ledger.reference.js';

test('OTP PostgreSQL claim lifecycle is immutable and cannot be deleted',
 {skip:!process.env.DATABASE_URL},async()=>{
  const schema='otp_immutable_'+randomBytes(8).toString('hex');
  const admin=new Pool({connectionString:process.env.DATABASE_URL,max:1});
  let db:Pool|undefined;
  let created=false;
  const key='a'.repeat(64);
  const fingerprint='b'.repeat(64);
  try{
   await admin.query('CREATE SCHEMA '+schema);
   created=true;
   db=new Pool({connectionString:process.env.DATABASE_URL,
    options:'-c search_path='+schema,max:2});
   await db.query(readFileSync(
    'docs/reference/otp-gateway-idempotency-ledger.sql','utf8',
   ));
   const gateway=new OtpGatewayPostgresLedger(db);
   assert.deepEqual(await gateway.claim(key,fingerprint),{decision:'send'});
   const forbidden=async(sql:string,params:unknown[])=>{
    await assert.rejects(db!.query(sql,params),
     (error:unknown)=>(error as {code?:string}).code==='P0001');
   };
   await forbidden(
    "UPDATE otp_gateway_delivery_claims SET fingerprint=$2 WHERE idempotency_key=$1",
    [key,'c'.repeat(64)],
   );
   await forbidden(
    'DELETE FROM otp_gateway_delivery_claims WHERE idempotency_key=$1',[key],
   );
   await forbidden(
    "INSERT INTO otp_gateway_delivery_claims(idempotency_key,fingerprint,status,provider_ref,accepted_at) VALUES($1,$2,'ACCEPTED',$3,now())",
    ['d'.repeat(64),fingerprint,'provider_99999999'],
   );
   assert.equal(await gateway.recordAccepted(
    key,fingerprint,'provider_12345678',
   ),true);
   assert.deepEqual(await gateway.claim(key,fingerprint),{
    decision:'accepted',providerRef:'provider_12345678',
   });
   await forbidden(
    "UPDATE otp_gateway_delivery_claims SET status='RESERVED',provider_ref=NULL,accepted_at=NULL WHERE idempotency_key=$1",
    [key],
   );
   await forbidden(
    "UPDATE otp_gateway_delivery_claims SET provider_ref=$2 WHERE idempotency_key=$1",
    [key,'provider_87654321'],
   );
   await forbidden(
    "UPDATE otp_gateway_delivery_claims SET claimed_at=now() WHERE idempotency_key=$1",
    [key],
   );
   await forbidden(
    'DELETE FROM otp_gateway_delivery_claims WHERE idempotency_key=$1',[key],
   );
   // TRUNCATE skips DELETE row triggers; its own statement trigger must deny
   // all attempts, including a cascading truncate and even an empty table.
   await forbidden('TRUNCATE TABLE otp_gateway_delivery_claims',[]);
   await forbidden('TRUNCATE TABLE otp_gateway_delivery_claims CASCADE',[]);
   const rows=await db.query<{
    status:string;fingerprint:string;provider_ref:string|null;
   }>('SELECT status,fingerprint,provider_ref FROM otp_gateway_delivery_claims WHERE idempotency_key=$1',[key]);
   assert.deepEqual(rows.rows,[{
    status:'ACCEPTED',fingerprint,provider_ref:'provider_12345678',
   }]);
  }finally{
   if(db)await db.end();
   if(created)await admin.query('DROP SCHEMA '+schema+' CASCADE');
   await admin.end();
  }
 });
