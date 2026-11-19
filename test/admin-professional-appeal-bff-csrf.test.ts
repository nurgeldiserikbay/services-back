import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import {assertAppealBffCsrf,issueAppealBffCsrf} from '../src/modules/admin/admin-professional-appeal-bff-csrf.js';

test('prepared appeal BFF CSRF proof binds session, appeal, operation, origin and expiry',()=>{
 const now=Date.UTC(2026,10,19,4,0,0);
 const base={
  sessionId:randomUUID(),appealId:randomUUID(),action:'decision' as const,
  origin:'https://admin.example.kz',csrfKey:randomBytes(32),
 };
 const token=issueAppealBffCsrf(base,now);
 const valid={
  ...base,method:'POST',requestOrigin:base.origin,fetchSite:'same-origin',
  contentType:'application/json',csrfToken:token,cookieAuthenticated:true,now,
 };
 assert.doesNotThrow(()=>assertAppealBffCsrf(valid));
 assert.doesNotThrow(()=>assertAppealBffCsrf({...valid,now:now+600_000}));
 const disallowed:Array<Partial<typeof valid>>=[
  {cookieAuthenticated:false},{method:'GET'},{method:'PUT'},
  {requestOrigin:'https://evil.example.kz'},
  {requestOrigin:'null'},{requestOrigin:undefined},
  {fetchSite:'cross-site'},{fetchSite:'same-site'},
  {fetchSite:'none'},{fetchSite:undefined},
  {contentType:'text/plain'},
  {contentType:'application/x-www-form-urlencoded'},
  {contentType:'application/json; charset=iso-8859-1'},
  {sessionId:randomUUID()},{appealId:randomUUID()},
  {action:'assignment' as typeof valid.action},
  {origin:'https://other.example.kz'},
  {csrfKey:randomBytes(32)},
  {csrfToken:''},{csrfToken:'v1.1.invalid.invalid'},
  {csrfToken:token.slice(0,-1)+'!'},
  {csrfToken:token+'suffix'},
  {now:now-1},{now:now+600_001},
 ];
 for(const override of disallowed){
  assert.throws(()=>assertAppealBffCsrf({...valid,...override}),UnauthorizedException,
   'rejected '+JSON.stringify(Object.keys(override)));
 }
 const fields=token.split('.');
 assert.equal(fields.length,4);
 assert.equal(fields[0],'v1');
 assert.match(fields[2],/^[A-Za-z0-9_-]{22}$/);
 const forged=[...fields];forged[2]=issueAppealBffCsrf(base,now).split('.')[2];
 assert.throws(()=>assertAppealBffCsrf({...valid,csrfToken:forged.join('.')}),UnauthorizedException);
 const later=issueAppealBffCsrf({...base,action:'assignment'},now);
 assert.throws(()=>assertAppealBffCsrf({...valid,csrfToken:later}),UnauthorizedException);
});

test('appeal BFF CSRF refuses malformed issuance context',()=>{
 const base={sessionId:randomUUID(),appealId:randomUUID(),
  action:'assignment' as const,origin:'https://admin.example.kz',csrfKey:randomBytes(32)};
 for(const override of [
  {sessionId:'bad'},{appealId:'bad'},{origin:'http://admin.example.kz'},
  {origin:'https://admin.example.kz/path'},{origin:'https://admin..example.kz'},
  {csrfKey:Buffer.alloc(0)},{csrfKey:randomBytes(16)},
 ]){
  assert.throws(()=>issueAppealBffCsrf({...base,...override}),UnauthorizedException);
 }
 assert.throws(()=>issueAppealBffCsrf(base,NaN),UnauthorizedException);
 assert.throws(()=>issueAppealBffCsrf(base,-1),UnauthorizedException);
});
