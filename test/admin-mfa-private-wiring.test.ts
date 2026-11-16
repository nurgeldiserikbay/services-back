import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {wirePrivateAdminMfa} from '../src/modules/admin/admin-mfa-private-wiring.js';

test('private MFA wiring uses the shared database lease and allowlisted vault reader',async()=>{
 let leases=0,reads=0;
 const client={query:async()=>({rows:[]}),release:()=>undefined};
 const key=randomBytes(32);
 const deps=wirePrivateAdminMfa({
  database:{connectForAdminMfa:async()=>{leases++;return client as never;}},
  accountSessionHmacKey:randomBytes(32).toString('base64'),
  adminSessionHmacKey:randomBytes(32).toString('base64'),
  transportKey:randomBytes(32).toString('base64'),
  allowedTotpVersions:['v1'],
  readTotpKey:async(version)=>{reads++;assert.equal(version,'v1');return key;},
 });
 assert.equal(leases,0);
 assert.equal(reads,0);
 assert.equal(await deps.pool.connect(),client);
 assert.equal(leases,1);
 assert.equal(await deps.resolveTotpKey('unexpected'),null);
 assert.equal(reads,0);
 assert.deepEqual(await deps.resolveTotpKey('v1'),key);
 assert.equal(reads,1);
});

test('private MFA wiring rejects missing database before configuring keys',()=>{
 assert.throws(()=>wirePrivateAdminMfa(null as never),/admin_mfa_database_unavailable/);
 assert.throws(()=>wirePrivateAdminMfa({database:null} as never),/admin_mfa_database_unavailable/);
});
