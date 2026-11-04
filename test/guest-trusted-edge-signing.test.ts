import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {
  canonicalTrustedNetworkBucket,signTrustedNetworkProof,
} from '../src/platform/security/trusted-network-edge.js';
import {verifyTrustedNetworkProof}
  from '../src/modules/guest-requests/guest-network-quota.js';

const digestKey=randomBytes(32);
const attestationKey=randomBytes(32);
const timestamp=Date.parse('2026-11-04T10:00:00.000Z');
const sign=(address:string,now=timestamp)=>signTrustedNetworkProof({
  authenticatedClientAddress:address,digestKey,attestationKey,now,
});

test('trusted edge signer interoperates with backend verifier and expires',()=>{
  const proof=sign('203.0.113.42');
  const digest=verifyTrustedNetworkProof(proof,attestationKey,timestamp);
  assert.match(digest??'',/^[0-9a-f]{64}$/);
  assert.equal(verifyTrustedNetworkProof(proof,attestationKey,timestamp+30001),null);
  assert.equal(verifyTrustedNetworkProof(proof,randomBytes(32),timestamp),null);
  const parts=proof.split('.');
  parts[1]='0'.repeat(64);
  assert.equal(verifyTrustedNetworkProof(parts.join('.'),attestationKey,timestamp),null);
});

test('IPv4 /24 and IPv6 /64 buckets are stable across address variants',()=>{
  assert.equal(canonicalTrustedNetworkBucket('203.0.113.1'),
    'v4:203.0.113.0/24');
  assert.equal(canonicalTrustedNetworkBucket('203.0.113.255'),
    'v4:203.0.113.0/24');
  assert.equal(canonicalTrustedNetworkBucket('2001:0DB8:0:0:1::1'),
    'v6:2001:0db8:0000:0000::/64');
  assert.equal(canonicalTrustedNetworkBucket('2001:db8::2'),
    'v6:2001:0db8:0000:0000::/64');
  const one=verifyTrustedNetworkProof(sign('203.0.113.1'),attestationKey,timestamp);
  const two=verifyTrustedNetworkProof(sign('203.0.113.201'),attestationKey,timestamp);
  const three=verifyTrustedNetworkProof(sign('203.0.114.1'),attestationKey,timestamp);
  assert.equal(one,two);
  assert.notEqual(one,three);
  const six1=verifyTrustedNetworkProof(sign('2001:db8::1'),attestationKey,timestamp);
  const six2=verifyTrustedNetworkProof(sign('2001:0db8:0:0:abcd::1'),attestationKey,timestamp);
  const six3=verifyTrustedNetworkProof(sign('2001:db8:0:1::1'),attestationKey,timestamp);
  assert.equal(six1,six2);
  assert.notEqual(six1,six3);
});

test('signing includes independent bucket and attestation keys',()=>{
  const signed=sign('203.0.113.1');
  const otherDigestKey=randomBytes(32);
  const changed=signTrustedNetworkProof({
    authenticatedClientAddress:'203.0.113.1',
    digestKey:otherDigestKey,attestationKey,now:timestamp,
  });
  assert.notEqual(signed,changed);
  assert.notEqual(signed.includes('203.0.113'),true);
  assert.notEqual(signed.includes('v4:'),true);
});

test('untrusted values and ambiguous addresses fail closed before signing',()=>{
  for(const address of [
    '',' 203.0.113.1','203.0.113.1 ','203.0.113.1, 198.51.100.1',
    '198.51.100.1:1234','[2001:db8::1]','localhost',
    '203.000.113.1','::ffff:203.0.113.1','::ffff:cb00:7101',
  ])assert.throws(()=>sign(address));
  assert.throws(()=>signTrustedNetworkProof({
    authenticatedClientAddress:'203.0.113.2',
    digestKey,attestationKey:digestKey,now:timestamp,
  }));
  assert.throws(()=>signTrustedNetworkProof({
    authenticatedClientAddress:'203.0.113.2',
    digestKey:Buffer.alloc(3),attestationKey,now:timestamp,
  }));
  assert.throws(()=>sign('203.0.113.2',Number.NaN));
});
