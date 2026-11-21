import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  createOtpGatewayMtlsReferenceServer,
} from '../src/platform/ingress/otp-gateway-mtls-listener.reference.js';

test('reference OTP mTLS listener refuses incomplete TLS configuration',()=>{
 const good={
  key:'private-key-placeholder',cert:'certificate-placeholder',
  ca:'ca-placeholder',approvedPins:()=>['ab'.repeat(32)],
 };
 for(const bad of [
  {...good,key:''},{...good,cert:''},{...good,ca:''},
  {...good,approvedPins:undefined},
  {...good,key:'x'.repeat(65_537)},
 ]){
  assert.throws(()=>createOtpGatewayMtlsReferenceServer(
   bad as typeof good,()=>{}),/otp_gateway_request_rejected/);
 }
 assert.throws(()=>createOtpGatewayMtlsReferenceServer(
  good,undefined as never),/otp_gateway_request_rejected/);
});
