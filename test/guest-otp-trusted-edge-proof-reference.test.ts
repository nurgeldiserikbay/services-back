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

test('dual stack IPv4 mapped IPv6 forms share the same network quota digest',()=>{
 const ipv4=makeTrustedOtpNetworkProof('203.0.113.9',
  identityKey,attestationKey,now);
 for(const equivalent of [
  '::ffff:203.0.113.9',
  '::ffff:cb00:7109',
  '0:0:0:0:0:ffff:cb00:7109',
 ]){
  const mapped=makeTrustedOtpNetworkProof(equivalent,
   identityKey,attestationKey,now);
  assert.equal(mapped,ipv4,'IPv4-mapped IPv6 must not evade a shared quota');
  assert.equal(verifyTrustedNetworkProof(mapped,attestationKey,now),
   verifyTrustedNetworkProof(ipv4,attestationKey,now));
 }
 // IPv4-translated IPv6 is a different network family, not IPv4-mapped.
 assert.notEqual(makeTrustedOtpNetworkProof('::ffff:0:203.0.113.9',
  identityKey,attestationKey,now),ipv4);
 assert.notEqual(makeTrustedOtpNetworkProof('::ffff:203.0.113.10',
  identityKey,attestationKey,now),ipv4);
});

test('operator opt-in /64 policy groups changing IPv6 privacy hosts',()=>{
 const base='2001:db8:abcd:42::1';
 const rotated='2001:0db8:abcd:0042:ffff:eeee:dddd:cccc';
 const other='2001:db8:abcd:43::1';
 const exactA=makeTrustedOtpNetworkProof(base,identityKey,attestationKey,now);
 const exactB=makeTrustedOtpNetworkProof(rotated,identityKey,attestationKey,now);
 assert.notEqual(exactA,exactB,'default exact addressing must not change');
 assert.equal(exactA,makeTrustedOtpNetworkProof(base,
  identityKey,attestationKey,now,'exact'));
 const prefixA=makeTrustedOtpNetworkProof(base,
  identityKey,attestationKey,now,'prefix64');
 const prefixB=makeTrustedOtpNetworkProof(rotated,
  identityKey,attestationKey,now,'prefix64');
 assert.equal(prefixA,prefixB,'same IPv6 /64 must have one quota ledger key');
 assert.notEqual(prefixA,makeTrustedOtpNetworkProof(other,
  identityKey,attestationKey,now,'prefix64'));
 assert.notEqual(prefixA,exactA,'different policies must not silently share quota identities');
 assert.match(verifyTrustedNetworkProof(prefixA,attestationKey,now)??'',
  /^[0-9a-f]{64}$/);
});

test('IPv4 and mapped IPv4 identities ignore IPv6-only grouping policy',()=>{
 const ipv4=makeTrustedOtpNetworkProof('203.0.113.9',
  identityKey,attestationKey,now,'prefix64');
 const mapped=makeTrustedOtpNetworkProof('::ffff:203.0.113.9',
  identityKey,attestationKey,now,'prefix64');
 assert.equal(ipv4,mapped);
 assert.equal(ipv4,makeTrustedOtpNetworkProof('203.0.113.9',
  identityKey,attestationKey,now));
 for(const bad of ['prefix56','/64','PREFIX64',null]){
  assert.throws(()=>makeTrustedOtpNetworkProof('2001:db8::1',
   identityKey,attestationKey,now,bad as never),
   /invalid_trusted_otp_edge_proof_input/);
 }
});

test('edge refuses non-client socket addresses before signing shared OTP quota',()=>{
 for(const address of [
  '0.0.0.0','0.1.2.3','127.0.0.1','127.10.20.30',
  '169.254.10.4','224.0.0.1','239.255.255.255',
  '240.0.0.1','255.255.255.255','::','::1','fe80::1',
  'febf::1234','ff02::1','ff0e::1',
  '::ffff:127.0.0.1','::ffff:169.254.1.2',
  '::ffff:224.0.0.1',
 ]){
  for(const grouping of ['exact','prefix64'] as const){
   assert.throws(()=>makeTrustedOtpNetworkProof(address,
    identityKey,attestationKey,now,grouping),
    /invalid_trusted_otp_edge_proof_input/,
    'do not sign non-client identity '+address);
  }
 }
 for(const address of [
  '203.0.113.9','::ffff:203.0.113.9','2001:db8::1',
  '192.0.2.21',
 ]){
  const proof=makeTrustedOtpNetworkProof(address,
   identityKey,attestationKey,now);
  assert.match(verifyTrustedNetworkProof(proof,attestationKey,now)??'',
   /^[0-9a-f]{64}$/);
 }
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
