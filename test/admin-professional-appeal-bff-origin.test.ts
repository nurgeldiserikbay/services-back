import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import {isTrustedAppealBffOrigin} from '../src/modules/admin/admin-professional-appeal-bff-origin.js';
import {issueAppealBffCsrfForSession} from '../src/modules/admin/admin-professional-appeal-bff-csrf-issuer.js';
import {executeAppealBffMutation} from '../src/modules/admin/admin-professional-appeal-bff-mutation.js';
import {logoutAppealBffSession} from '../src/modules/admin/admin-professional-appeal-bff-logout.js';

test('BFF origin policy requires canonical configured HTTPS authority',()=>{
 for(const origin of ['https://admin.example.kz','https://admin.example.kz:8443',
  'https://a.example.kz','https://localhost:4443'])
  assert.equal(isTrustedAppealBffOrigin(origin),true,origin);
 for(const origin of [null,undefined,'','https://','http://admin.example.kz',
  'https://admin.example.kz/','https://admin.example.kz/path',
  'https://admin.example.kz?query=1','https://admin.example.kz/#fragment',
  'https://user@admin.example.kz','https://admin..example.kz',
  'https://-admin.example.kz','https://admin-.example.kz',
  'https://admin.example.kz:0','https://admin.example.kz:65536',
  'https://admin.example.kz:443','https://ADMIN.example.kz',
  'https://admin.example.kz.','https://admin.example.kz:99999',
  'https://admin.example.kz\r\nSet-Cookie: x=y'])
  assert.equal(isTrustedAppealBffOrigin(origin),false,String(origin));
});

test('issuer, mutation and logout deny missing or malformed trusted origin before any adapter',async()=>{
 const origin='https://admin.example.kz',sessionCookie=randomBytes(32).toString('base64url');
 const cookieHeader='__Host-services-appeal-session='+sessionCookie;
 let resolveCalls=0,executions=0,claims=0,revocations=0;
 const request={sessionCookie,appealId:randomUUID(),action:'assignment' as const,
  method:'POST',requestOrigin:origin,expectedOrigin:origin,
  fetchSite:'same-origin',csrfKey:randomBytes(32)};
 const mutation={...request,body:{},contentType:'application/json',csrfToken:'invalid'};
 const deps={resolveSession:async()=>{resolveCalls++;return null;},
  claimCsrfProof:async()=>{claims++;return true;},
  execute:async()=>{executions++;return null;}};
 const logoutDeps={revokeSession:async()=>{revocations++;return true;}};
 for(const expectedOrigin of [undefined,null,'','http://admin.example.kz',
  'https://admin.example.kz/path','https://user@admin.example.kz',
  'https://admin..example.kz','https://admin.example.kz:443']){
  const patch={expectedOrigin,requestOrigin:expectedOrigin};
  await assert.rejects(issueAppealBffCsrfForSession({...request,...patch} as typeof request,deps),
   UnauthorizedException);
  await assert.rejects(executeAppealBffMutation({...mutation,...patch} as typeof mutation,deps),
   UnauthorizedException);
  await assert.rejects(logoutAppealBffSession({
   rawCookieHeader:cookieHeader,method:'POST',fetchSite:'same-origin',...patch,
  } as Parameters<typeof logoutAppealBffSession>[0],logoutDeps),UnauthorizedException);
 }
 assert.equal(resolveCalls,0);
 assert.equal(claims,0);
 assert.equal(executions,0);
 assert.equal(revocations,0);
});
