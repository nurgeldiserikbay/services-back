import assert from 'node:assert/strict';
import {test} from 'node:test';
import {makeOtpGatewayMonitorPoolConfig} from
 '../src/platform/ingress/otp-gateway-monitor-tls.reference.js';

const url='postgresql://observer:password@gateway-db.internal:5432/gateway';
const ca='-----BEGIN CERTIFICATE-----\nTEST-ONLY-PLACEHOLDER\n-----END CERTIFICATE-----';

test('OTP operator PG connection requires explicit CA and certificate verification',()=>{
 const config=makeOtpGatewayMonitorPoolConfig(url,ca);
 assert.equal(config.connectionString,url);
 assert.deepEqual(config.ssl,{
  ca,rejectUnauthorized:true,minVersion:'TLSv1.2',
 });
 assert.equal(config.max,1);
 assert.equal(config.connectionTimeoutMillis,5000);
});

test('OTP operator PG config denies TLS overrides in connection URL',()=>{
 for(const suffix of [
  '?sslmode=disable','?sslmode=require','?sslmode=no-verify',
  '?sslrootcert=/tmp/other-ca','?sslcert=/tmp/cert',
  '?application_name=report','#fragment',
 ]){
  assert.throws(()=>makeOtpGatewayMonitorPoolConfig(url+suffix,ca),{
   message:'otp_gateway_operator_report_unavailable',
  },suffix);
 }
});

test('OTP operator PG config fails closed on absent or malformed trust config',()=>{
 for(const [connection,trust] of [
  [url,undefined],[url,''],[url,'not-a-certificate'],
  [undefined,ca],['postgresql:///gateway',ca],
  ['http://observer:pass@gateway-db.internal/gateway',ca],
  ['postgresql://observer:pass@/gateway',ca],
 ] as const){
  assert.throws(()=>makeOtpGatewayMonitorPoolConfig(connection,trust),{
   message:'otp_gateway_operator_report_unavailable',
  });
 }
});
