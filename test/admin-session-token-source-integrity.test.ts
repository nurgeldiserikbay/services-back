import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {hashAdminSessionToken} from '../src/modules/admin/admin-session-token.js';

test('admin session token regex remains an executable declaration',()=>{
 const source=readFileSync(new URL('../src/modules/admin/admin-session-token.ts',import.meta.url),'utf8');
 assert.match(source,/^const TOKEN=\/\^\[A-Za-z0-9_-\]\{42\}\[AQgw\]\$\/;/m);
 assert.doesNotMatch(source,/Reject\\n\/\//);
});

test('admin token hashing accepts canonical 32-byte proof only',()=>{
 const pepper=Buffer.alloc(32,7);
 assert.match(hashAdminSessionToken('A'.repeat(43),pepper),/^[0-9a-f]{64}$/);
 assert.throws(()=>hashAdminSessionToken('A'.repeat(42)+'B',pepper),/invalid_admin_session_proof/);
});
