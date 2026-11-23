import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readOtpGatewayOperatorReport,runOtpGatewayOperatorReportReadOnly} from
 '../src/platform/ingress/otp-gateway-operator-report.reference.js';

const restricted={
 status_allowed:true,claimed_allowed:true,
 identifier_allowed:false,fingerprint_allowed:false,
 reference_allowed:false,receipt_time_allowed:false,
 can_mutate:false,relation_is_persistent_table:true,
 relation_in_expected_schema:true,
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

test('operator report denies shadowed or non-persistent ledger relation',async()=>{
 for(const relation of [false,null,undefined,'true']){
  let calls=0;
  const db={query:async()=>{
   calls++;
   return {rows:[{...restricted,relation_is_persistent_table:relation}]};
  }};
  await assert.rejects(readOtpGatewayOperatorReport(db as never),{
   message:'otp_gateway_operator_report_unavailable',
  });
  assert.equal(calls,1);
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

test('operator report denies a persistent namesake in the wrong schema',async()=>{
 let calls=0;
 await assert.rejects(readOtpGatewayOperatorReport({
  query:async(_sql:string,params?:unknown[])=>{
   calls++;
   assert.deepEqual(params,['gateway_ledger']);
   return {rows:[{...restricted,relation_in_expected_schema:false}]};
  },
 } as never,'gateway_ledger'),{
  message:'otp_gateway_operator_report_unavailable',
 });
 assert.equal(calls,1);
});

test('operator report pins configured schema BEFORE privilege check and report',async()=>{
 const queries:{sql:string;params?:unknown[]}[]=[];
 let releases=0;
 const pool={connect:async()=>({
  query:async(sql:string,params?:unknown[])=>{
   queries.push({sql,params});
   if(sql.includes('has_column_privilege'))return {rows:[restricted]};
   if(sql.includes("WHERE status='RESERVED'"))return {rows:[snapshot]};
   return {rows:[]};
  },
  release:(destroy?:boolean)=>{assert.equal(destroy,true);releases++;},
 })};
 const result=await runOtpGatewayOperatorReportReadOnly(pool as never,'gateway_ledger');
 assert.equal(result.total,'3');
 assert.equal(releases,1);
 assert.equal(queries.length,5);
 assert.equal(queries[0].sql,'BEGIN TRANSACTION READ ONLY');
 assert.match(queries[1].sql,/set_config\('search_path'/);
 assert.deepEqual(queries[1].params,['gateway_ledger']);
 assert.match(queries[2].sql,/relation_in_expected_schema/);
 assert.deepEqual(queries[2].params,['gateway_ledger']);
 assert.match(queries[3].sql,/WHERE status='RESERVED'/);
 assert.equal(queries[4].sql,'ROLLBACK');
});

test('operator report refuses untrusted configured schema without connecting',async()=>{
 let connects=0;
 const pool={connect:async()=>{connects++;throw Error('unreachable');}};
 for(const schema of ['pg_temp','pg_catalog','information_schema',
  'public;DROP TABLE users','other schema','UPPER','']){
  await assert.rejects(
   runOtpGatewayOperatorReportReadOnly(pool as never,schema),
   {message:'otp_gateway_operator_report_unavailable'},
  );
 }
 assert.equal(connects,0);
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
  release:(destroy?:boolean)=>{assert.equal(destroy,true);releases++;},
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
  release:(destroy?:boolean)=>{assert.equal(destroy,true);releases++;},
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
  release:(destroy?:boolean)=>{assert.equal(destroy,true);released++;},
 })};
 await assert.rejects(runOtpGatewayOperatorReportReadOnly(pool as never),{
  message:'otp_gateway_operator_report_unavailable',
 });
 assert.equal(queries,1);
 assert.equal(released,1);
});

test('operator report sanitizes a connection disposal failure after success',async()=>{
 let releases=0;
 const pool={connect:async()=>({
  query:async(sql:string)=>{
   if(sql.includes('has_column_privilege'))return {rows:[restricted]};
   if(sql.includes("WHERE status='RESERVED'"))return {rows:[snapshot]};
   return {rows:[]};
  },
  release:()=>{
   releases++;
   throw new Error('private connection details in release');
  },
 })};
 await assert.rejects(runOtpGatewayOperatorReportReadOnly(pool as never,'gateway_ledger'),{
  message:'otp_gateway_operator_report_unavailable',
 });
 assert.equal(releases,1);
});

test('operator report sanitizes a connection disposal failure on ACL denial',async()=>{
 let releases=0;
 const pool={connect:async()=>({
  query:async(sql:string)=>{
   if(sql.includes('has_column_privilege'))
    return {rows:[{...restricted,can_mutate:true}]};
   return {rows:[]};
  },
  release:()=>{
   releases++;
   throw new Error('private connection details in release');
  },
 })};
 await assert.rejects(runOtpGatewayOperatorReportReadOnly(pool as never,'gateway_ledger'),{
  message:'otp_gateway_operator_report_unavailable',
 });
 assert.equal(releases,1);
});

test('staging observer requires server-reported TLS on its own readonly connection',async()=>{
 for(const observed of [
  {ssl:false,version:null},
  {ssl:true,version:'TLSv1.1'},
  {ssl:'true',version:'TLSv1.3'},
 ]){
  const queries:string[]=[];
  let releases=0;
  const pool={connect:async()=>({
   query:async(sql:string)=>{
    queries.push(sql);
    if(sql.includes('pg_stat_ssl'))return {rows:[observed]};
    if(sql.includes('has_column_privilege'))return {rows:[restricted]};
    if(sql.includes("WHERE status='RESERVED'"))
     throw Error('aggregate must not run before SSL verification');
    return {rows:[]};
   },
   release:(destroy?:boolean)=>{assert.equal(destroy,true);releases++;},
  })};
  await assert.rejects(
   runOtpGatewayOperatorReportReadOnly(pool as never,'gateway_ledger',true),
   {message:'otp_gateway_operator_report_unavailable'},
  );
  assert.equal(releases,1);
  assert.ok(queries.some(sql=>sql.includes('pg_stat_ssl')));
  assert.ok(!queries.some(sql=>sql.includes('has_column_privilege')));
  assert.equal(queries.at(-1),'ROLLBACK');
 }
});

test('staging observer accepts server TLS before ACL and aggregates',async()=>{
 const queries:string[]=[];
 let releases=0;
 const pool={connect:async()=>({
  query:async(sql:string)=>{
   queries.push(sql);
   if(sql.includes('pg_stat_ssl'))
    return {rows:[{ssl:true,version:'TLSv1.3'}]};
   if(sql.includes('has_column_privilege'))return {rows:[restricted]};
   if(sql.includes("WHERE status='RESERVED'"))return {rows:[snapshot]};
   return {rows:[]};
  },
  release:(destroy?:boolean)=>{assert.equal(destroy,true);releases++;},
 })};
 const result=await runOtpGatewayOperatorReportReadOnly(
  pool as never,'gateway_ledger',true,
 );
 assert.equal(result.total,'3');
 assert.equal(releases,1);
 assert.equal(queries[0],'BEGIN TRANSACTION READ ONLY');
 assert.match(queries[1],/set_config/);
 assert.match(queries[2],/pg_stat_ssl/);
 assert.match(queries[3],/has_column_privilege/);
 assert.match(queries[4],/WHERE status='RESERVED'/);
 assert.equal(queries[5],'ROLLBACK');
});

test('staging observer verifies connected DB identity before ACL and aggregate SQL',async()=>{
 for(const actual of ['services',null,undefined]){
  const queries:string[]=[];
  let released=0;
  const pool={connect:async()=>({
   query:async(sql:string)=>{
    queries.push(sql);
    if(sql.includes('pg_stat_ssl'))
     return {rows:[{ssl:true,version:'TLSv1.3'}]};
    if(sql.includes('current_database()'))
     return {rows:[{name:actual}]};
    if(sql.includes('has_column_privilege'))
     throw Error('database mismatch must fail before ACL');
    return {rows:[]};
   },
   release:(destroy?:boolean)=>{assert.equal(destroy,true);released++;},
  })};
  await assert.rejects(
   runOtpGatewayOperatorReportReadOnly(
    pool as never,'gateway_ledger',true,'otp_staging',
   ),{message:'otp_gateway_operator_report_unavailable'},
  );
  assert.equal(released,1);
  assert.ok(queries.some(sql=>sql.includes('current_database()')));
  assert.ok(!queries.some(sql=>sql.includes('has_column_privilege')));
  assert.equal(queries.at(-1),'ROLLBACK');
 }
});

test('staging observer accepts pinned DB identity then validates role and aggregates',async()=>{
 const queries:string[]=[];
 let released=0;
 const pool={connect:async()=>({
  query:async(sql:string)=>{
   queries.push(sql);
   if(sql.includes('pg_stat_ssl'))
    return {rows:[{ssl:true,version:'TLSv1.3'}]};
   if(sql.includes('current_database()'))
    return {rows:[{name:'otp_staging'}]};
   if(sql.includes('has_column_privilege'))return {rows:[restricted]};
   if(sql.includes("WHERE status='RESERVED'"))return {rows:[snapshot]};
   return {rows:[]};
  },
  release:(destroy?:boolean)=>{assert.equal(destroy,true);released++;},
 })};
 const result=await runOtpGatewayOperatorReportReadOnly(
  pool as never,'gateway_ledger',true,'otp_staging',
 );
 assert.equal(result.total,'3');
 assert.equal(released,1);
 assert.match(queries[2],/pg_stat_ssl/);
 assert.match(queries[3],/current_database/);
 assert.match(queries[4],/has_column_privilege/);
 assert.match(queries[5],/WHERE status='RESERVED'/);
 assert.equal(queries[6],'ROLLBACK');
});

test('staging observer denies wrong session or effective role before ACL',async()=>{
 for(const identity of [
  {session_role:'admin',effective_role:'observer'},
  {session_role:'observer',effective_role:'admin'},
  {session_role:'postgres',effective_role:'postgres'},
  {session_role:null,effective_role:'observer'},
 ]){
  const sqls:string[]=[];
  let released=0;
  const pool={connect:async()=>({
   query:async(sql:string)=>{
    sqls.push(sql);
    if(sql.includes('pg_stat_ssl'))
     return {rows:[{ssl:true,version:'TLSv1.3'}]};
    if(sql.includes('current_database()'))
     return {rows:[{name:'otp_staging'}]};
    if(sql.includes('session_user::text'))
     return {rows:[identity]};
    if(sql.includes('has_column_privilege'))
     throw new Error('role mismatch must stop before ACL');
    return {rows:[]};
   },
   release:(destroy?:boolean)=>{assert.equal(destroy,true);released++;},
  })};
  await assert.rejects(
   runOtpGatewayOperatorReportReadOnly(
    pool as never,'gateway_ledger',true,'otp_staging','observer',
   ),{message:'otp_gateway_operator_report_unavailable'},
  );
  assert.equal(released,1);
  assert.ok(sqls.some(sql=>sql.includes('session_user::text')));
  assert.ok(!sqls.some(sql=>sql.includes('has_column_privilege')));
  assert.equal(sqls.at(-1),'ROLLBACK');
 }
});

test('staging observer permits approved login and effective role before ACL',async()=>{
 const sqls:string[]=[];
 let released=0;
 const pool={connect:async()=>({
  query:async(sql:string)=>{
   sqls.push(sql);
   if(sql.includes('pg_stat_ssl'))
    return {rows:[{ssl:true,version:'TLSv1.3'}]};
   if(sql.includes('current_database()'))
    return {rows:[{name:'otp_staging'}]};
   if(sql.includes('session_user::text'))
    return {rows:[{session_role:'observer',effective_role:'observer'}]};
   if(sql.includes('has_column_privilege'))return {rows:[restricted]};
   if(sql.includes("WHERE status='RESERVED'"))return {rows:[snapshot]};
   return {rows:[]};
  },
  release:(destroy?:boolean)=>{assert.equal(destroy,true);released++;},
 })};
 const result=await runOtpGatewayOperatorReportReadOnly(
  pool as never,'gateway_ledger',true,'otp_staging','observer',
 );
 assert.equal(result.total,'3');
 assert.equal(released,1);
 assert.match(sqls[2],/pg_stat_ssl/);
 assert.match(sqls[3],/current_database/);
 assert.match(sqls[4],/session_user/);
 assert.match(sqls[5],/has_column_privilege/);
 assert.match(sqls[6],/WHERE status='RESERVED'/);
 assert.equal(sqls[7],'ROLLBACK');
});
