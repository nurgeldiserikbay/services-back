import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('private MFA controller stays unregistered until vault and DB wiring is ready',()=>{
 const controller=readFileSync('src/modules/admin/admin-mfa-private.controller.ts','utf8');
 const module=readFileSync('src/modules/admin/admin-moderation.module.ts','utf8');
 assert.match(controller,/requirePrivateAdminMfaAccess\(access\)/);
 assert.match(controller,/parsePrivateAdminMfaRequest\(body\)/);
 assert.match(controller,/throw new NotFoundException\(\)/);
 assert.match(controller,/Cache-Control','private, no-store/);
 assert.doesNotMatch(module,/PrivateAdminMfaController/);
 assert.doesNotMatch(controller,/return\s*\{\s*token|session_token\s*:/);
});
