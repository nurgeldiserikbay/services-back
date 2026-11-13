import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {sealAdminTotpSecret,openAdminTotpSecret} from '../src/modules/admin/admin-totp-secret.js';

const staffId=randomUUID();
const secret=randomBytes(32);
const key=randomBytes(32);

test('TOTP secret envelope round-trips with authenticated staff binding',()=>{
 const envelope=sealAdminTotpSecret(secret,staffId,key);
 assert.match(envelope,/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
 assert.deepEqual(openAdminTotpSecret(envelope,staffId,key),secret);
 assert.equal(openAdminTotpSecret(envelope,randomUUID(),key),null);
 assert.equal(openAdminTotpSecret(envelope,staffId,randomBytes(32)),null);
 assert.notEqual(sealAdminTotpSecret(secret,staffId,key),envelope);
});

test('TOTP secret envelope rejects tampering and noncanonical encodings',()=>{
 const envelope=sealAdminTotpSecret(secret,staffId,key);
 const fields=envelope.split('.');
 assert.equal(openAdminTotpSecret('v2.'+fields.slice(1).join('.'),staffId,key),null);
 assert.equal(openAdminTotpSecret(envelope+'.extra',staffId,key),null);
 const alteredTag=(fields[3]![0]==='A'?'B':'A')+fields[3]!.slice(1);
 assert.equal(openAdminTotpSecret([...fields.slice(0,3),alteredTag].join('.'),staffId,key),null);
 assert.equal(openAdminTotpSecret('v1.invalid',staffId,key),null);
 assert.equal(openAdminTotpSecret(null,staffId,key),null);
});

test('TOTP envelope validates secret and encryption key lengths',()=>{
 assert.throws(()=>sealAdminTotpSecret(Buffer.alloc(19),staffId,key),
  /invalid_admin_totp_secret_envelope/);
 assert.throws(()=>sealAdminTotpSecret(secret,staffId,Buffer.alloc(16)),
  /invalid_admin_totp_secret_envelope/);
 assert.throws(()=>sealAdminTotpSecret(secret,'invalid',key),
  /invalid_admin_totp_secret_envelope/);
 assert.equal(openAdminTotpSecret('v1.x.y.z',staffId,Buffer.alloc(16)),null);
});
