import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {buildTrustedGuestOtpIssuanceHeaders}
 from '../src/platform/ingress/guest-otp-issuance-headers.edge.js';
import {verifyTrustedNetworkProof}
 from '../src/modules/guest-requests/guest-network-quota.js';

const identityKey=randomBytes(32);
const attestationKey=randomBytes(32);
const now=1_795_179_200_123;
const token=randomBytes(32).toString('base64url');

const hostile=new Headers({
 'x-services-network-proof':'v1.fake.fake.fake',
 'guest-capability':'forged-browser-capability',
 'guest-completion-capability':'forged-completion',
 'authorization':'Bearer forged-user',
 'cookie':'guest_session=forged',
 'forwarded':'for=198.51.100.1',
 'x-forwarded-for':'198.51.100.2',
 'x-real-ip':'198.51.100.3',
 'x-services-csrf':'forged-csrf',
 'proxy-authorization':'Basic secret',
 'host':'attacker.example',
 'content-type':'text/plain',
 'content-length':'999999999',
});

const trusted=(purpose:'CREATE_REQUEST'|'MANAGE_SCHEDULE'|'COMPLETE_REQUEST')=>({
 purpose,clientAddress:'203.0.113.9',identityKey,attestationKey,now,
 ...((purpose==='CREATE_REQUEST')?{}:{readCapability:token}),
});

test('CREATE_REQUEST edge reference creates only own signed proof and JSON type',()=>{
 const clean=buildTrustedGuestOtpIssuanceHeaders(hostile,trusted('CREATE_REQUEST'));
 assert.deepEqual([...clean.keys()].sort(),
  ['content-type','x-services-network-proof']);
 assert.equal(clean.get('content-type'),'application/json');
 assert.equal(clean.get('guest-capability'),null);
 assert.match(verifyTrustedNetworkProof(
  clean.get('x-services-network-proof'),attestationKey,now)??'',/^[0-9a-f]{64}$/);
 assert.equal(hostile.get('guest-capability'),'forged-browser-capability',
  'reference must never mutate original client input');
});

test('request scoped OTP routes get only authenticated server-supplied capability',()=>{
 for(const purpose of ['MANAGE_SCHEDULE','COMPLETE_REQUEST'] as const){
  const clean=buildTrustedGuestOtpIssuanceHeaders(hostile,trusted(purpose));
  assert.deepEqual([...clean.keys()].sort(),
   ['content-type','guest-capability','x-services-network-proof']);
  assert.equal(clean.get('guest-capability'),token);
  assert.equal(clean.get('x-forwarded-for'),null);
  assert.equal(clean.get('authorization'),null);
  assert.equal(clean.get('cookie'),null);
  assert.equal(clean.get('guest-completion-capability'),null);
  assert.equal(clean.get('host'),null);
  assert.match(verifyTrustedNetworkProof(
   clean.get('x-services-network-proof'),attestationKey,now)??'',/^[0-9a-f]{64}$/);
 }
});

test('untrusted capability, missing server proof or wrong source fails closed',()=>{
 const missing={purpose:'COMPLETE_REQUEST' as const,
  clientAddress:'203.0.113.9',identityKey,attestationKey,now};
 assert.throws(()=>buildTrustedGuestOtpIssuanceHeaders(hostile,missing),
  /invalid_trusted_otp_header_context/);
 assert.throws(()=>buildTrustedGuestOtpIssuanceHeaders(hostile,{
  ...trusted('CREATE_REQUEST'),readCapability:token,
 }),/invalid_trusted_otp_header_context/);
 assert.throws(()=>buildTrustedGuestOtpIssuanceHeaders(hostile,{
  ...trusted('MANAGE_SCHEDULE'),readCapability:'forged-browser-capability',
 }),/invalid_trusted_otp_header_context/);
 assert.throws(()=>buildTrustedGuestOtpIssuanceHeaders(hostile,{
  ...trusted('COMPLETE_REQUEST'),clientAddress:'198.51.100.2, 203.0.113.9',
 }),/invalid_trusted_otp_edge_proof_input/);
 assert.throws(()=>buildTrustedGuestOtpIssuanceHeaders(hostile,{
  ...trusted('COMPLETE_REQUEST'),attestationKey:identityKey,
 }),/invalid_trusted_otp_edge_proof_input/);
 assert.throws(()=>buildTrustedGuestOtpIssuanceHeaders(hostile,{
  ...trusted('COMPLETE_REQUEST'),now:0,
 }),/invalid_trusted_otp_edge_proof_input/);
});

test('trusted output invariant under adversarial inbound headers',()=>{
 const empty=new Headers();
 const a=buildTrustedGuestOtpIssuanceHeaders(empty,trusted('COMPLETE_REQUEST'));
 const b=buildTrustedGuestOtpIssuanceHeaders(hostile,trusted('COMPLETE_REQUEST'));
 assert.deepEqual([...a.entries()],[...b.entries()]);
});

test('dual-stack ingress does not create separate OTP quota identities',()=>{
 const ipv4=buildTrustedGuestOtpIssuanceHeaders(hostile,
  {...trusted('COMPLETE_REQUEST'),clientAddress:'203.0.113.9'});
 const mapped=buildTrustedGuestOtpIssuanceHeaders(hostile,
  {...trusted('COMPLETE_REQUEST'),clientAddress:'::ffff:203.0.113.9'});
 assert.equal(mapped.get('x-services-network-proof'),
  ipv4.get('x-services-network-proof'));
 assert.equal(mapped.get('guest-capability'),token);
 assert.equal(verifyTrustedNetworkProof(mapped.get('x-services-network-proof'),
  attestationKey,now),verifyTrustedNetworkProof(
  ipv4.get('x-services-network-proof'),attestationKey,now));
});

test('explicit IPv6 /64 issuance header policy is stable across privacy hosts',()=>{
 const a=buildTrustedGuestOtpIssuanceHeaders(hostile,{
  ...trusted('COMPLETE_REQUEST'),clientAddress:'2001:db8:abcd:42::1',
  ipv6Grouping:'prefix64',
 });
 const b=buildTrustedGuestOtpIssuanceHeaders(new Headers(),{
  ...trusted('COMPLETE_REQUEST'),clientAddress:'2001:db8:abcd:42::ffab',
  ipv6Grouping:'prefix64',
 });
 assert.equal(a.get('x-services-network-proof'),b.get('x-services-network-proof'));
 assert.equal(a.get('guest-capability'),token);
 assert.match(verifyTrustedNetworkProof(a.get('x-services-network-proof'),
  attestationKey,now)??'',/^[0-9a-f]{64}$/);
 const defaultExact=buildTrustedGuestOtpIssuanceHeaders(hostile,{
  ...trusted('COMPLETE_REQUEST'),clientAddress:'2001:db8:abcd:42::1',
 });
 assert.notEqual(a.get('x-services-network-proof'),
  defaultExact.get('x-services-network-proof'));
});

test('edge-only allowlist helper is not imported by runtime controllers',()=>{
 for(const p of [
  'src/main.ts',
  'src/modules/guest-requests/guest-otp-http.controller.ts',
  'src/modules/guest-requests/guest-completion-http.controller.ts',
  'src/modules/guest-requests/guest-schedule-access-http.controller.ts',
 ]){
  assert.doesNotMatch(readFileSync(p,'utf8'),
   /buildTrustedGuestOtpIssuanceHeaders|guest-otp-issuance-headers\.edge/);
 }
});
