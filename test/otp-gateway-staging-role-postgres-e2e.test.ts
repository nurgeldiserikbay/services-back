import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from 'pg';
import {runOtpGatewayOperatorReportReadOnly} from
 '../src/platform/ingress/otp-gateway-operator-report.reference.js';

/**
 * Disposable CI PostgreSQL negative path for the staging observer role pin.
 * The real server supplies session_user/current_user and current_database().
 * TLS preflight remains separately covered by the protocol and TLS E2Es;
 * this test is NOT authorization to deploy against a staging gateway.
 */
test('OTP observer refuses wrong approved role on real PostgreSQL before ACL',
 {skip:!process.env.DATABASE_URL},async()=>{
  const pool=new Pool({
   connectionString:process.env.DATABASE_URL,max:1,
   connectionTimeoutMillis:5_000,
  });
  try{
   const identity=await pool.query<{
    db_name:string;login_role:string;effective_role:string;
   }>('SELECT current_database() AS db_name, session_user::text AS login_role, current_user::text AS effective_role');
   assert.equal(identity.rows.length,1);
   const actual=identity.rows[0]!;
   // Test the mismatch irrespective of CI's PostgreSQL login naming.
   const wrongRole=actual.login_role==='observer_wrong_pin'?
    'observer_other_pin':'observer_wrong_pin';
   const queries:string[]=[];
   let releases=0;
   const instrumented={connect:async()=>{
    const client=await pool.connect();
    return {
     query:(sql:string,params?:unknown[])=>{
      queries.push(sql);
      return client.query(sql,params);
     },
     release:(destroy?:boolean)=>{
      assert.equal(destroy,true);
      releases++;
      client.release(destroy);
     },
    };
   }};
   await assert.rejects(
    runOtpGatewayOperatorReportReadOnly(
     instrumented as never,undefined,false,actual.db_name,wrongRole,
    ),
    {message:'otp_gateway_operator_report_unavailable'},
   );
   assert.equal(releases,1,'rejecting role must destroy the pinned session');
   assert.equal(queries.length,4,'wrong role must deny before querying ledger');
   assert.equal(queries[0],'BEGIN TRANSACTION READ ONLY');
   assert.match(queries[1],/current_database\(\)/);
   assert.match(queries[2],/session_user::text.*current_user::text/);
   assert.equal(queries[3],'ROLLBACK');
   assert.ok(!queries.some(sql=>/has_column_privilege|otp_gateway_delivery_claims/.test(sql)),
    'no observer ACL or ledger query is allowed after wrong-role detection');
  }finally{
   await pool.end();
  }
});
