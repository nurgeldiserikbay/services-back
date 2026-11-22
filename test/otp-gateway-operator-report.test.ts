import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readOtpGatewayOperatorReport,runOtpGatewayOperatorReportReadOnly} from
 '../src/platform/ingress/otp-gateway-operator-report.reference.js';

const restricted={
 status_allowed:true,claimed_allowed:true,
 identifier_allowed:false,fingerprint_allowed:false,
 reference_allowed:false,receipt_time_allowed:false,
 can_mutate:false,
};
const snapshot={
 total:'3',recent:'1',middle:'1',older:'1',
 oldest_claimed_at:new Date('2026-11-22T00:00:00Z'),
};

test('operator report returns aggregates only after an ACL preflight',async()=>{
 const statements:string[]=[];
 const db={query:async(sql:string)=>{
  statements.push(sql);
  return {rows:[statements.length===1?restricted:snapshot]};
 }};
 assert.deepEqual(await readOtpGatewayOperatorReport(db as never),{
  unresolvedCount:'3',oldestClaimedAt:'2026-11-22T00:00:00.000Z',
  total:'3',underFiveMinutes:'1',fiveMinutesToOneHour:'1',
  oneHourOrOlder:'1',
 });
 assert.equal(statements.length,2);
 assert.match(statements[0],/has_any_column_privilege/);
 assert.match(statements[0],/has_column_privilege/);
 assert.match(statements[1],/WHERE status='RESERVED'/);
 assert.doesNotMatch(statements[1],/idempotency_key|fingerprint|provider_ref/i);
});

test('operator report refuses roles with direct PII, receipts or mutation access',async()=>{
 for(const flag of [
  'identifier_allowed','fingerprint_allowed','reference_allowed',
  'receipt_time_allowed','can_mutate',
 ] as const){
  let calls=0;
  const db={query:async()=>{
   calls++;
   return {rows:[{...restricted,[flag]:true}]};
  }};
  await assert.rejects(readOtpGatewayOperatorReport(db as never),{
   message:'otp_gateway_operator_report_unavailable',
  });
  assert.equal(calls,1,flag);
 }
 for(const flag of ['status_allowed','claimed_allowed'] as const){
  let calls=0;
  const db={query:async()=>{
   calls++;
   return {rows:[{...restricted,[flag]:false}]};
  }};
  await assert.rejects(readOtpGatewayOperatorReport(db as never),{
   message:'otp_gateway_operator_report_unavailable',
  });
  assert.equal(calls,1,flag);
 }
});

test('operator report fails closed and sanitizes malformed ACL and SQL errors',async()=>{
 for(const rows of [
  [],[restricted,restricted],[{...restricted,can_mutate:null}],
  [{...restricted,status_allowed:'true'}],
 ]){
  await assert.rejects(readOtpGatewayOperatorReport({
   query:async()=>({rows}),
  } as never),{message:'otp_gateway_operator_report_unavailable'});
 }
 await assert.rejects(readOtpGatewayOperatorReport({
  query:async()=>{throw new Error('database private message');},
 } as never),{message:'otp_gateway_operator_report_unavailable'});
});

test('operator report pins ACL and aggregates to one READ ONLY session',async()=>{
 const statements:string[]=[];
 let connects=0;
 let releases=0;
 const db={
  query:async(sql:string)=>{
   statements.push(sql);
   if(sql.includes('has_column_privilege'))return {rows:[restricted]};
   if(sql.includes("WHERE status='RESERVED'"))return {rows:[snapshot]};
   return {rows:[]};
  },
  release:()=>{releases++;},
 };
 const pool={connect:async()=>{connects++;return db;}};
 assert.deepEqual(await runOtpGatewayOperatorReportReadOnly(pool as never),{
  unresolvedCount:'3',oldestClaimedAt:'2026-11-22T00:00:00.000Z',
  total:'3',underFiveMinutes:'1',fiveMinutesToOneHour:'1',
  oneHourOrOlder:'1',
 });
 assert.equal(connects,1);
 assert.equal(releases,1);
 assert.equal(statements.length,4);
 assert.equal(statements[0],'BEGIN TRANSACTION READ ONLY');
 assert.match(statements[1],/has_column_privilege/);
 assert.match(statements[2],/WHERE status='RESERVED'/);
 assert.equal(statements[3],'ROLLBACK');
});

test('operator report rolls back, releases, and sanitizes ACL denial',async()=>{
 const statements:string[]=[];
 let releases=0;
 const pool={connect:async()=>({
  query:async(sql:string)=>{
   statements.push(sql);
   return {rows:[{...restricted,identifier_allowed:true}]};
  },
  release:()=>{releases++;},
 })};
 await assert.rejects(
  runOtpGatewayOperatorReportReadOnly(pool as never),
  {message:'otp_gateway_operator_report_unavailable'},
 );
 assert.deepEqual(statements,[
  'BEGIN TRANSACTION READ ONLY',
  statements[1],
  'ROLLBACK',
 ]);
 assert.match(statements[1],/has_column_privilege/);
 assert.equal(releases,1);
});

test('operator report sanitizes transaction startup errors and releases client',async()=>{
 let released=0;
 let queries=0;
 const pool={connect:async()=>({
  query:async()=>{queries++;throw new Error('private DB configuration');},
  release:()=>{released++;},
 })};
 await assert.rejects(runOtpGatewayOperatorReportReadOnly(pool as never),{
  message:'otp_gateway_operator_report_unavailable',
 });
 assert.equal(queries,1);
 assert.equal(released,1);
});
