import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {makeTrustedOtpNetworkProof}
 from '../src/platform/ingress/guest-otp-network-proof.edge.js';
import {verifyTrustedNetworkProof}
 from '../src/modules/guest-requests/guest-network-quota.js';

const identityKey=randomBytes(32);
const attestationKey=randomBytes(32);
const now=1_795_179_200_123;

test('edge-only signing reference roundtrips through real backend verifier',()=>{
 const proof=makeTrustedOtpNetworkProof('203.0.113.9',identityKey,attestationKey,now);
 const digest=verifyTrustedNetworkProof(proof,attestationKey,now);
 assert.match(proof,/^v1\.[0-9a-f]{64}\.[0-9]{13}\.[0-9a-f]{64}$/);
 assert.match(digest??'',/^[0-9a-f]{64}$/);
 assert.ok(!proof.includes('203.0.113.9'));
 assert.ok(!proof.includes(identityKey.toString('hex')));
 assert.equal(makeTrustedOtpNetworkProof('203.0.113.9',
  identityKey,attestationKey,now),proof);
 assert.equal(verifyTrustedNetworkProof(proof,attestationKey,now+30_001),null);
 assert.equal(verifyTrustedNetworkProof(proof,attestationKey,now-30_001),null);
 const pieces=proof.split('.');
 const changed=[pieces[0],pieces[1],pieces[2],('0'===pieces[3][0]?'1':'0')+pieces[3].slice(1)].join('.');
 assert.equal(verifyTrustedNetworkProof(changed,attestationKey,now),null);
 assert.equal(verifyTrustedNetworkProof(proof,identityKey,now),null);
});

test('equivalent IPv6 text forms map to one keyed quota identity',()=>{
 const a=makeTrustedOtpNetworkProof('2001:0db8:0:0:0:0:0:1',
  identityKey,attestationKey,now);
 const b=makeTrustedOtpNetworkProof('2001:db8::1',
  identityKey,attestationKey,now);
 assert.equal(a,b);
 assert.notEqual(a,makeTrustedOtpNetworkProof('2001:db8::2',
  identityKey,attestationKey,now));
 assert.notEqual(a,makeTrustedOtpNetworkProof('203.0.113.9',
  identityKey,attestationKey,now));
});

test('edge reference rejects untrusted host/header strings and weak key configuration',()=>{
 for(const untrusted of [
  '', ' 203.0.113.9', '203.0.113.9, 192.0.2.1',
  'X-Forwarded-For: 203.0.113.9','[2001:db8::1]',
  'localhost','127.0.0.1:1234',null,undefined,
 ]){
  assert.throws(()=>makeTrustedOtpNetworkProof(untrusted,
   identityKey,attestationKey,now),
   /invalid_trusted_otp_edge_proof_input/);
 }
 for(const [idKey,macKey] of [
  [Buffer.alloc(0),attestationKey],
  [identityKey,Buffer.alloc(16)],
  [identityKey,identityKey],
 ]){
  assert.throws(()=>makeTrustedOtpNetworkProof('203.0.113.9',
   idKey,macKey,now),/invalid_trusted_otp_edge_proof_input/);
 }
 for(const timestamp of [0,1e10,Number.NaN,Number.MAX_SAFE_INTEGER]){
  assert.throws(()=>makeTrustedOtpNetworkProof('203.0.113.9',
   identityKey,attestationKey,timestamp),
   /invalid_trusted_otp_edge_proof_input/);
 }
});

test('reference edge signer is not imported by runtime controllers or browser code',()=>{
 const runtime=[
  'src/main.ts',
  'src/modules/guest-requests/guest-otp-http.controller.ts',
  'src/modules/guest-requests/guest-completion-http.controller.ts',
  'src/modules/guest-requests/guest-schedule-access-http.controller.ts',
 ];
 for(const path of runtime){
  assert.doesNotMatch(readFileSync(path,'utf8'),
   /makeTrustedOtpNetworkProof|guest-otp-network-proof\.edge/);
 }
});
