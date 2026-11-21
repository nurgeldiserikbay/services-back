import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {Pool} from 'pg';
import {OtpGatewayPostgresLedger} from
 '../src/platform/ingress/otp-gateway-postgres-ledger.reference.js';

const key=(suffix:string)=>('a'.repeat(63)+suffix);
const fingerprint=(suffix:string)=>('b'.repeat(63)+suffix);

test('separate OTP gateway PostgreSQL ledger reserves once across parallel clients', {
 skip:!process.env.DATABASE_URL,
},async()=>{
 const schema='otp_gateway_test_'+randomBytes(8).toString('hex');
 const admin=new Pool({connectionString:process.env.DATABASE_URL,max:1});
 let db:Pool|undefined;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  db=new Pool({
   connectionString:process.env.DATABASE_URL,
   max:4,
   options:'-c search_path='+schema,
  });
  await db.query(readFileSync('docs/reference/otp-gateway-idempotency-ledger.sql','utf8'));
  const a=new OtpGatewayPostgresLedger(db);
  const b=new OtpGatewayPostgresLedger(db);
  const id=key('0');
  const fp=fingerprint('0');
  const results=await Promise.all([
   a.claim(id,fp),b.claim(id,fp),a.claim(id,fp),b.claim(id,fp),
  ]);
  assert.equal(results.filter(x=>x.decision==='send').length,1);
  assert.equal(results.filter(x=>x.decision==='in_flight').length,3);

  assert.deepEqual(await b.claim(id,fingerprint('1')),{decision:'conflict'});
  assert.equal(await a.recordAccepted(id,fingerprint('1'),'provider_12345678'),false);
  assert.deepEqual(await a.claim(id,fp),{decision:'in_flight'});
  assert.equal(await b.recordAccepted(id,fp,'provider_12345678'),true);
  assert.equal(await a.recordAccepted(id,fp,'provider_12345678'),false);
  assert.deepEqual(await b.claim(id,fp),{
   decision:'accepted',providerRef:'provider_12345678',
  });
  assert.deepEqual(await a.claim(id,fingerprint('1')),{decision:'conflict'});

  const second=await Promise.all([a.claim(key('1'),fingerprint('1')),
   b.claim(key('2'),fingerprint('2'))]);
  assert.deepEqual(second,[{decision:'send'},{decision:'send'}]);
  const rows=await db.query<{n:string}>(
   'SELECT count(*)::text AS n FROM otp_gateway_delivery_claims',
  );
  assert.equal(rows.rows[0]?.n,'3');
  const columns=await db.query<{column_name:string}>(`
   SELECT column_name FROM information_schema.columns
   WHERE table_schema=$1 AND table_name='otp_gateway_delivery_claims'
  `,[schema]);
  const names=columns.rows.map(x=>x.column_name);
  assert.ok(!names.includes('destination')&&!names.includes('code')&&
   !names.includes('contact')&&!names.includes('token'));
 }finally{
  if(db)await db.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');
  await admin.end();
 }
});

test('gateway ledger refuses malformed keys or unsafe provider receipts before SQL',async()=>{
 let calls=0;
 const db={
  query:async()=>{calls++;throw new Error('should_not_query');},
 } as unknown as Pool;
 const ledger=new OtpGatewayPostgresLedger(db);
 for(const bad of ['',key('z'),'not-a-key',null]){
  await assert.rejects(ledger.claim(bad,fingerprint('0')),
   /otp_gateway_ledger_unavailable/);
  await assert.rejects(ledger.recordAccepted(bad,fingerprint('0'),'provider_12345678'),
   /otp_gateway_ledger_unavailable/);
 }
 for(const bad of ['',fingerprint('z'),null]){
  await assert.rejects(ledger.claim(key('0'),bad),
   /otp_gateway_ledger_unavailable/);
 }
 for(const bad of ['',null,'short','external:destination']){
  await assert.rejects(ledger.recordAccepted(key('0'),fingerprint('0'),bad),
   /otp_gateway_ledger_unavailable/);
 }
 assert.equal(calls,0);
});

test('gateway ledger sanitizes PostgreSQL failures without falling back to sending',async()=>{
 const db={
  query:async()=>{throw new Error('connection details should stay private');},
 } as unknown as Pool;
 const ledger=new OtpGatewayPostgresLedger(db);
 await assert.rejects(ledger.claim(key('0'),fingerprint('0')),e=>
  e instanceof Error&&e.message==='otp_gateway_ledger_unavailable');
 await assert.rejects(
  ledger.recordAccepted(key('0'),fingerprint('0'),'provider_12345678'),
  e=>e instanceof Error&&e.message==='otp_gateway_ledger_unavailable');
});
