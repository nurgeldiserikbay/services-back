import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import {extractAppealBffSessionCookie} from '../src/modules/admin/admin-professional-appeal-bff-cookie.js';
import {
 APPEAL_BFF_SESSION_COOKIE,buildAppealBffSessionSetCookie,
 buildAppealBffSessionClearCookie,
} from '../src/modules/admin/admin-professional-appeal-bff-cookie-policy.js';

test('appeal BFF session cookie attributes are host-bound and non-script-readable',()=>{
 const opaque=randomBytes(32).toString('base64url');
 const cookie=buildAppealBffSessionSetCookie(opaque,3600);
 assert.equal(cookie,APPEAL_BFF_SESSION_COOKIE+'='+opaque+
  '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600');
 assert.ok(!cookie.includes('Domain='));
 assert.equal(extractAppealBffSessionCookie(cookie.split(';')[0]),opaque);
 assert.equal(buildAppealBffSessionClearCookie(),
  APPEAL_BFF_SESSION_COOKIE+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');
});

test('cookie issuance rejects browser-controlled or overlong values and lifetimes',()=>{
 const opaque=randomBytes(32).toString('base64url');
 const bad:unknown[]=[null,undefined,'','bad', 'abc; Domain=evil.example',
  'abc\r\nSet-Cookie: x=y','x'.repeat(513),'ä'.repeat(32)];
 for(const proof of bad)
  assert.throws(()=>buildAppealBffSessionSetCookie(proof,3600),UnauthorizedException);
 for(const age of [-1,0,3601,1.5,NaN,Infinity,'3600',undefined,null])
  assert.throws(()=>buildAppealBffSessionSetCookie(opaque,age),UnauthorizedException);
 assert.equal(buildAppealBffSessionSetCookie(opaque,1).includes('Max-Age=1'),true);
});
