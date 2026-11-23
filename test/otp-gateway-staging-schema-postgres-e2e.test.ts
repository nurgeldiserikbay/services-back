import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from 'pg';
import {runOtpGatewayOperatorReportReadOnly} from
 '../src/platform/ingress/otp-gateway-operator-report.reference.js';

/**
 * Real PostgreSQL, disposable CI-only negative path. An independently
 * specified schema that does not contain the dedicated OTP ledger must not
 * silently fall back to public or another search_path entry.
 */
test('OTP operator rejects an absent pinned ledger schema on real PostgreSQL',
 {skip:!process.env.DATABASE_URL},async()=>{
  const pool=new Pool({
   connectionString:process.env.DATABASE_URL,max:1,
   connectionTimeoutMillis:5_000,
  });
  try{
   const result=await pool.query<{db:string}>(
    'SELECT pg_catalog.current_database() AS db',
   );
   assert.equal(result.rows.length,1);
   const actualDatabase=result.rows[0]!.db;
   // No database objects are created. Pick a schema name confirmed absent
   // from the actual disposable server, not an assumed fixture.
   let missingSchema='';
   for(const candidate of ['otp_observer_schema_missing_ci',
     'otp_observer_schema_missing_ci_2']){
    const exists=await pool.query<{found:boolean}>(
     'SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1) AS found',
     [candidate],
    );
    if(exists.rows[0]?.found===false){
     missingSchema=candidate;
     break;
    }
   }
   assert.notEqual(missingSchema,'','expected at least one absent test schema');
   const statements:string[]=[];
   const paramsSeen:unknown[][]=[];
   let destroyed=0;
   const instrumented={connect:async()=>{
    const client=await pool.connect();
    return {
     query:(sql:string,params?:unknown[])=>{
      statements.push(sql);
      paramsSeen.push(params??[]);
      return client.query(sql,params);
     },
     release:(destroy?:boolean)=>{
      assert.equal(destroy,true);
      destroyed++;
      client.release(destroy);
     },
    };
   }};
   await assert.rejects(
    runOtpGatewayOperatorReportReadOnly(
     instrumented as never,missingSchema,false,actualDatabase,
    ),
    {message:'otp_gateway_operator_report_unavailable'},
   );
   assert.equal(destroyed,1,'failed preflight must destroy the session');
   assert.equal(statements[0],'BEGIN TRANSACTION READ ONLY');
   assert.match(statements[1]??'',/set_config\('search_path'/);
   assert.deepEqual(paramsSeen[1],[missingSchema],
    'approved schema must be bound as a query parameter');
   assert.equal(statements[2],
    'SELECT pg_catalog.current_database() AS name');
   assert.match(statements[3]??'',/has_column_privilege/,
    'the ACL check must reject an absent pinned ledger');
   assert.equal(statements.at(-1),'ROLLBACK');
   assert.equal(statements.length,5,
    'failed ACL must not proceed to any reservation aggregate');
   assert.ok(!statements.some(sql=>
    /count\s*\(|min\s*\(/i.test(sql)),
    'no reservation aggregate should run on a missing approved schema');
  }finally{
   await pool.end();
  }
});
