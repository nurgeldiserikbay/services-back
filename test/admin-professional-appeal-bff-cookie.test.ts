import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import {extractAppealBffSessionCookie} from '../src/modules/admin/admin-professional-appeal-bff-cookie.js';

test('prepared browser cookie boundary selects only one exact opaque __Host session',()=>{
 const token=randomBytes(32).toString('base64url');
 assert.equal(extractAppealBffSessionCookie('__Host-services-appeal-session='+token),token);
 assert.equal(extractAppealBffSessionCookie('theme=light; __Host-services-appeal-session='+token+'; locale=kk'),token);
});

test('prepared cookie boundary rejects duplicates, ambiguity and malformed input',()=>{
 const token=randomBytes(32).toString('base64url');
 const name='__Host-services-appeal-session';
 const invalid:unknown[]=[
  undefined,null,'','theme=dark',name+'=short',name+'='+token+'; '+name+'='+token,
  name+'='+token+'; theme=light; theme=dark',
  name+'='+token+'; broken',name+'='+token+'; =bad',
  name+'="'+token+'"',name+'='+token+'; another="quoted"',
  name+'='+token+'; another=bad value',
  name+'='+token+'; another=x\n',
  name+'='+token+'; other=x; '.repeat(40),
  name+'='+token+'; '+name.toLowerCase()+'=bad',
  name+'='+token+'; other=%ZZ',
  name+'='+token+'; other=æ',
  name+'='+token+'; x='+('a'.repeat(4100)),
 ];
 // Percent encoding in an unrelated cookie is a valid opaque cookie-octet;
 // a future adapter must not decode it as the BFF session.
 invalid.splice(invalid.indexOf(name+'='+token+'; other=%ZZ'),1);
 for(const raw of invalid){
  assert.throws(()=>extractAppealBffSessionCookie(raw),UnauthorizedException,
   'must reject '+String(raw).slice(0,80));
 }
 assert.throws(()=>extractAppealBffSessionCookie(name+'='+token,'session'),UnauthorizedException);
});
