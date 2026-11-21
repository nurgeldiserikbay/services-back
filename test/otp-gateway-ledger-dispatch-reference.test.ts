import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {Pool} from 'pg';
import {OtpGatewayPostgresLedger} from
 '../src/platform/ingress/otp-gateway-postgres-ledger.reference.js';
import {OtpGatewayLedgerDispatchReference} from
 '../src/platform/ingress/otp-gateway-ledger-dispatch.reference.js';

const key=(ending:string)=>'a'.repeat(63)+ending;
const fingerprint=(ending:string)=>'b'.repeat(63)+ending;
const approved={accepted:true as const,providerRef:'provider_12345678'};

test('gateway orchestration serializes vendor delivery across parallel PostgreSQL claimants',{
 skip:!process.env.DATABASE_URL,
},async()=>{
 const schema='otp_gateway_dispatch_'+randomBytes(8).toString('hex');
 const admin=new Pool({connectionString:process.env.DATABASE_URL,max:1});
 let db:Pool|undefined;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  db=new Pool({
   connectionString:process.env.DATABASE_URL,max:6,
   options:'-c search_path='+schema,
  });
  await db.query(readFileSync('docs/reference/otp-gateway-idempotency-ledger.sql','utf8'));
  const ledgerA=new OtpGatewayPostgresLedger(db);
  const ledgerB=new OtpGatewayPostgresLedger(db);
  const a=new OtpGatewayLedgerDispatchReference(ledgerA);
  const b=new OtpGatewayLedgerDispatchReference(ledgerB);
  const input={idempotencyKey:key('0'),fingerprint:fingerprint('0')};
  let sends=0;
  let complete:((outcome:typeof approved)=>void)|undefined;
  const vendor={
   sendOnce:async()=>new Promise<typeof approved>(resolve=>{
    sends++;complete=resolve;
   }),
  };
  const first=a.dispatch(input,vendor);
  // Give first claim time to reach vendor before competing claims.
  for(let i=0;i<60&&!complete;i++){
   await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.ok(complete,'first claimant must reach provider');
  const duplicates=await Promise.all(Array.from({length:8},(_,i)=>
   (i%2?a:b).dispatch(input,vendor)));
  assert.deepEqual(duplicates,Array.from({length:8},()=>({status:'in_flight'})));
  assert.equal(sends,1);
  assert.deepEqual(await b.dispatch({
   idempotencyKey:input.idempotencyKey,fingerprint:fingerprint('1'),
  },vendor),{status:'conflict'});
  assert.equal(sends,1);
  complete(approved);
  assert.deepEqual(await first,{status:'accepted',providerRef:approved.providerRef});
  assert.deepEqual(await b.dispatch(input,vendor),{
   status:'accepted',providerRef:approved.providerRef,
  });
  assert.equal(sends,1);
  const rows=await db.query<{status:string;provider_ref:string}>(
   'SELECT status,provider_ref FROM otp_gateway_delivery_claims',
  );
  assert.deepEqual(rows.rows,[{
   status:'ACCEPTED',provider_ref:approved.providerRef,
  }]);
 }finally{
  if(db)await db.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');
  await admin.end();
 }
});

test('vendor error leaves durable reservation unresolved and never retries automatically',{
 skip:!process.env.DATABASE_URL,
},async()=>{
 const schema='otp_gateway_dispatch_'+randomBytes(8).toString('hex');
 const admin=new Pool({connectionString:process.env.DATABASE_URL,max:1});
 let db:Pool|undefined;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  db=new Pool({connectionString:process.env.DATABASE_URL,
   options:'-c search_path='+schema});
  await db.query(readFileSync('docs/reference/otp-gateway-idempotency-ledger.sql','utf8'));
  const gateway=new OtpGatewayLedgerDispatchReference(new OtpGatewayPostgresLedger(db));
  const input={idempotencyKey:key('1'),fingerprint:fingerprint('1')};
  let sends=0;
  const vendor={sendOnce:async()=>{
   sends++;
   throw new Error('provider response includes phone and OTP');
  }};
  await assert.rejects(gateway.dispatch(input,vendor),
   e=>e instanceof Error&&e.message==='otp_gateway_delivery_unavailable');
  assert.deepEqual(await gateway.dispatch(input,vendor),{status:'in_flight'});
  assert.equal(sends,1);
  const rows=await db.query<{status:string;provider_ref:string|null}>(
   'SELECT status,provider_ref FROM otp_gateway_delivery_claims',
  );
  assert.deepEqual(rows.rows,[{status:'RESERVED',provider_ref:null}]);
 }finally{
  if(db)await db.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');
  await admin.end();
 }
});

test('gateway refuses aborted requests and ledger failures without contacting vendor',async()=>{
 let attempts=0;
 const vendor={sendOnce:async()=>{
  attempts++;return approved;
 }};
 const unavailable={claim:async()=>{
  throw new Error('sensitive SQL details');
 },recordAccepted:async()=>true};
 const gateway=new OtpGatewayLedgerDispatchReference(unavailable);
 const input={idempotencyKey:key('0'),fingerprint:fingerprint('0')};
 const aborted=new AbortController();aborted.abort();
 await assert.rejects(gateway.dispatch(input,vendor,aborted.signal),
  /otp_gateway_delivery_unavailable/);
 await assert.rejects(gateway.dispatch(input,vendor),
  e=>e instanceof Error&&e.message==='otp_gateway_delivery_unavailable');
 assert.equal(attempts,0);
});

test('gateway requires successful durable acceptance before claiming delivery',async()=>{
 let sends=0;
 const fake={
  claim:async()=>({decision:'send' as const}),
  recordAccepted:async()=>false,
 };
 const gateway=new OtpGatewayLedgerDispatchReference(fake);
 await assert.rejects(gateway.dispatch({
  idempotencyKey:key('0'),fingerprint:fingerprint('0'),
 },{sendOnce:async()=>{sends++;return approved;}}),
 /otp_gateway_delivery_unavailable/);
 assert.equal(sends,1);
});
