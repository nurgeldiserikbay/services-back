import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {verifyGuestCancelBffAttestation} from '../src/modules/requests/guest-cancel-bff-attestation.js';

test('BFF cancellation attestation binds exact command and capability',()=>{
  const secret=randomBytes(32),now=1800000000000;
  const requestId=randomUUID(),rawBody='{"expectedVersion":1}';
  const idempotencyKey='CancelGuest_2026_12345678';
  const capability=randomBytes(32).toString('base64url');
  const timestamp=String(now);
  const payload=JSON.stringify(['services-guest-cancel-bff:v1',timestamp,
    'POST','/v1/requests/'+requestId+'/cancel',rawBody,idempotencyKey,capability]);
  const attestation='v1.'+timestamp+'.'+createHmac('sha256',secret)
    .update(payload,'utf8').digest('hex');
  const input={requestId,rawBody,idempotencyKey,capability,attestation};
  assert.deepEqual(verifyGuestCancelBffAttestation(input,secret,now),
    {requestId,expectedVersion:1,idempotencyKey});
  for(const changes of [
    {requestId:randomUUID()},{rawBody:'{"expectedVersion":2}'},
    {rawBody:' {"expectedVersion":1}'},{idempotencyKey:idempotencyKey+'x'},
    {capability:randomBytes(32).toString('base64url')},
    {attestation:undefined},{attestation:[attestation]},
    {attestation:attestation+'x'},
  ]){
    assert.equal(verifyGuestCancelBffAttestation({...input,...changes},secret,now),null);
  }
  assert.equal(verifyGuestCancelBffAttestation(input,secret,now+30001),null);
  assert.equal(verifyGuestCancelBffAttestation(input,secret,now-30001),null);
  assert.equal(verifyGuestCancelBffAttestation(input,randomBytes(32),now),null);
  assert.equal(verifyGuestCancelBffAttestation(input,Buffer.alloc(31),now),null);
});
