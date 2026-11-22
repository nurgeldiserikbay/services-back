import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {Pool} from 'pg';
import {OtpGatewayPostgresLedger} from
 '../src/platform/ingress/otp-gateway-postgres-ledger.reference.js';

test('OTP gateway writer role may claim and ACK but cannot destroy ledger or disable guards',
 {skip:!process.env.DATABASE_URL},async()=>{
  const suffix=randomBytes(8).toString('hex');
  const schema='otp_writer_acl_'+suffix;
  const role='otp_writer_'+suffix;
  const key='a'.repeat(64);
  const fingerprint='b'.repeat(64);
  const admin=new Pool({connectionString:process.env.DATABASE_URL,max:1});
  let db:Pool|undefined;
  let schemaCreated=false;
  let roleCreated=false;
  try{
   await admin.query('CREATE SCHEMA '+schema);
   schemaCreated=true;
   db=new Pool({connectionString:process.env.DATABASE_URL,
    options:'-c search_path='+schema,max:2});
   await db.query(readFileSync(
    'docs/reference/otp-gateway-idempotency-ledger.sql','utf8',
   ));
   await admin.query('CREATE ROLE '+role+' NOLOGIN');
   roleCreated=true;
   await admin.query('GRANT USAGE ON SCHEMA '+schema+' TO '+role);
   await admin.query(
    'GRANT SELECT ON '+schema+'.otp_gateway_delivery_claims TO '+role,
   );
   await admin.query(
    'GRANT INSERT (idempotency_key,fingerprint,status) ON '+
     schema+'.otp_gateway_delivery_claims TO '+role,
   );
   await admin.query(
    'GRANT UPDATE (status,provider_ref,accepted_at) ON '+
     schema+'.otp_gateway_delivery_claims TO '+role,
   );
   const client=await db.connect();
   try{
    await client.query('SET ROLE '+role);
    const identity=await client.query<{current_user:string}>('SELECT current_user');
    assert.equal(identity.rows[0]?.current_user,role);
    const ledger=new OtpGatewayPostgresLedger(client as never);
    assert.deepEqual(await ledger.claim(key,fingerprint),{decision:'send'});
    assert.deepEqual(await ledger.claim(key,fingerprint),{decision:'in_flight'});
    assert.equal(await ledger.recordAccepted(
     key,fingerprint,'provider_12345678',
    ),true);
    assert.deepEqual(await ledger.claim(key,fingerprint),{
     decision:'accepted',providerRef:'provider_12345678',
    });
    for(const sql of [
     'DELETE FROM otp_gateway_delivery_claims WHERE idempotency_key=$1',
     'TRUNCATE TABLE otp_gateway_delivery_claims',
     'TRUNCATE TABLE otp_gateway_delivery_claims CASCADE',
     'ALTER TABLE otp_gateway_delivery_claims DISABLE TRIGGER otp_gateway_guard_claim_update',
     'DROP TRIGGER otp_gateway_guard_claim_delete ON otp_gateway_delivery_claims',
     'DROP TABLE otp_gateway_delivery_claims',
    ]){
     await assert.rejects(
      client.query(sql,sql.includes('$1')?[key]:[]),
      (error:unknown)=>(error as {code?:string}).code==='42501',
      sql,
     );
    }
    // Column-level grants deny immutable metadata changes even before
    // the trigger has a chance to inspect the attempted UPDATE.
    for(const column of ['fingerprint','idempotency_key','claimed_at']){
     await assert.rejects(
      client.query(
       'UPDATE otp_gateway_delivery_claims SET '+column+'='+column+
        ' WHERE idempotency_key=$1',[key],
      ),
      (error:unknown)=>(error as {code?:string}).code==='42501',
      column,
     );
    }
    // Allowed UPDATE columns still cannot rewrite an ACCEPTED receipt,
    // because PostgreSQL's immutability trigger rejects the transition.
    await assert.rejects(
     client.query(
      'UPDATE otp_gateway_delivery_claims SET provider_ref=$2 WHERE idempotency_key=$1',
      [key,'provider_87654321'],
     ),
     (error:unknown)=>(error as {code?:string}).code==='P0001',
    );
    await assert.rejects(
     client.query(
      "INSERT INTO otp_gateway_delivery_claims(idempotency_key,fingerprint,status,claimed_at) VALUES($1,$2,'RESERVED',now())",
      ['c'.repeat(64),fingerprint],
     ),
     (error:unknown)=>(error as {code?:string}).code==='42501',
    );
   }finally{
    await client.query('RESET ROLE');
    client.release();
   }
   const rows=await db.query<{status:string;provider_ref:string}>(
    'SELECT status,provider_ref FROM otp_gateway_delivery_claims WHERE idempotency_key=$1',
    [key],
   );
   assert.deepEqual(rows.rows,[{
    status:'ACCEPTED',provider_ref:'provider_12345678',
   }]);
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
