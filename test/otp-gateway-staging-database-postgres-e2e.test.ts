import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from 'pg';
import {runOtpGatewayOperatorReportReadOnly} from
 '../src/platform/ingress/otp-gateway-operator-report.reference.js';

/**
 * Disposable CI PostgreSQL negative-path evidence for the independently
 * approved database pin. No TLS or deployed gateway is involved here.
 */
test('OTP observer denies wrong approved database on real PostgreSQL before ACL',
 {skip:!process.env.DATABASE_URL},async()=>{
  const pool=new Pool({
   connectionString:process.env.DATABASE_URL,max:1,
   connectionTimeoutMillis:5_000,
  });
  try{
   const result=await pool.query<{name:string}>(
    'SELECT pg_catalog.current_database() AS name',
   );
   assert.equal(result.rows.length,1);
   const actual=result.rows[0]!.name;
   const wrongDatabase=actual==='observer_wrong_db'?
    'observer_other_db':'observer_wrong_db';
   const queries:string[]=[];
   let destroyedReleases=0;
   const instrumented={connect:async()=>{
    const client=await pool.connect();
    return {
     query:(sql:string,params?:unknown[])=>{
      queries.push(sql);
      return client.query(sql,params);
     },
     release:(destroy?:boolean)=>{
      assert.equal(destroy,true);
      destroyedReleases++;
      client.release(destroy);
     },
    };
   }};
   await assert.rejects(
    runOtpGatewayOperatorReportReadOnly(
     instrumented as never,undefined,false,wrongDatabase,
    ),
    {message:'otp_gateway_operator_report_unavailable'},
   );
   assert.equal(destroyedReleases,1,
    'wrong database identity must destroy the pinned connection');
   assert.equal(queries.length,3,
    'wrong database must reject before observer role, ACL or ledger reads');
   assert.equal(queries[0],'BEGIN TRANSACTION READ ONLY');
   assert.equal(queries[1],'SELECT pg_catalog.current_database() AS name');
   assert.equal(queries[2],'ROLLBACK');
   assert.ok(!queries.some(sql=>
    /has_column_privilege|otp_gateway_delivery_claims|session_user/.test(sql)),
    'no observer ACL, ledger or role inspection after database mismatch');
  }finally{
   await pool.end();
  }
});
