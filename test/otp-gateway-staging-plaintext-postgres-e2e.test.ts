import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from 'pg';
import {runOtpGatewayOperatorReportReadOnly} from
 '../src/platform/ingress/otp-gateway-operator-report.reference.js';

/**
 * PostgreSQL-backed negative acceptance of the staging TLS preflight.
 * Uses the existing disposable CI database, NEVER a production/staging
 * environment or an OTP provider. Performs no writes or migrations.
 */
test('OTP staging observer rejects an actual plaintext PostgreSQL session',
 {skip:!process.env.DATABASE_URL},async(t)=>{
  const pool=new Pool({
   connectionString:process.env.DATABASE_URL,ssl:false,max:1,
   connectionTimeoutMillis:5_000,
  });
  try{
   const observed=await pool.query<{ssl:boolean;version:string|null}>(
    'SELECT ssl,version FROM pg_stat_ssl WHERE pid=pg_backend_pid()',
   );
   // A production server that mandates TLS cannot exercise this negative
   // path. Do not loosen server policy to test it.
   if(observed.rows[0]?.ssl!==false){
    t.skip('PostgreSQL endpoint does not permit plaintext test connections');
    return;
   }
   assert.equal(observed.rows[0]?.version,null);
   const statements:string[]=[];
   let releases=0;
   const instrumented={
    connect:async()=>{
     const client=await pool.connect();
     return {
      query:async(sql:string,params?:unknown[])=>{
       statements.push(sql);
       return client.query(sql,params);
      },
      release:(destroy?:boolean)=>{
       assert.equal(destroy,true);
       releases++;
       client.release(destroy);
      },
     };
    },
   };
   await assert.rejects(
    runOtpGatewayOperatorReportReadOnly(
     instrumented as never,undefined,true,
    ),
    {message:'otp_gateway_operator_report_unavailable'},
   );
   assert.equal(releases,1,'one-shot connection must be destroyed');
   assert.equal(statements.length,3,'must deny before ACL or aggregates');
   assert.equal(statements[0],'BEGIN TRANSACTION READ ONLY');
   assert.match(statements[1],/pg_stat_ssl.*pg_backend_pid\(\)/s);
   assert.equal(statements[2],'ROLLBACK');
  }finally{
   await pool.end();
  }
 });
