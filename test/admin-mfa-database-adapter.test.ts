import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adminMfaPoolAdapter} from '../src/modules/admin/admin-mfa-database-adapter.js';

test('admin MFA adapter leases exactly one connection from shared database owner',async()=>{
 const client={query:async()=>({rows:[]}),release:()=>undefined};
 let leases=0;
 const adapter=adminMfaPoolAdapter({
  connectForAdminMfa:async()=>{leases++;return client as never;},
 });
 assert.equal(leases,0);
 assert.equal(await adapter.connect(),client);
 assert.equal(leases,1);
 assert.deepEqual(Object.keys(adapter),['connect']);
});

test('admin MFA adapter fails closed without a database lease provider',()=>{
 assert.throws(()=>adminMfaPoolAdapter(null as never),/admin_mfa_database_unavailable/);
 assert.throws(()=>adminMfaPoolAdapter({} as never),/admin_mfa_database_unavailable/);
});
