import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {NestFactory} from '@nestjs/core';
import {Module} from '@nestjs/common';
import {PlatformAdminLogoutController} from '../src/modules/admin/admin-logout.controller.js';
import {PlatformAdminLogoutService} from '../src/modules/admin/admin-logout.service.js';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';

test('admin logout HTTP route rejects missing bearer and does not cache responses',async()=>{
 let calls=0;
 class FakeLogoutService{
  async logout(header:unknown){
   calls++;
   if(typeof header!=='string'||!header.startsWith('Bearer '))
    throw new (await import('@nestjs/common')).UnauthorizedException('Authentication required');
  }
 }
 @Module({
  controllers:[PlatformAdminLogoutController],
  providers:[{provide:PlatformAdminLogoutService,useClass:FakeLogoutService}],
 })
 class TestModule{}
 const app=await NestFactory.create(TestModule,{logger:false});
 app.setGlobalPrefix('v1');
 try{
  await app.listen(0,'127.0.0.1');
  const address=app.getHttpServer().address();
  assert.ok(address&&typeof address!=='string');
  const url=`http://127.0.0.1:${address.port}/v1/admin/session/logout`;
  const denied=await fetch(url,{method:'POST'});
  assert.equal(denied.status,401);
  assert.match(denied.headers.get('cache-control')??'',/no-store/);
  assert.equal(denied.headers.get('x-robots-tag'),'noindex, nofollow');
  const bearer=issueAdminSessionToken(randomBytes(32)).token;
  const allowed=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${bearer}`}});
  assert.equal(allowed.status,200);
  assert.deepEqual(await allowed.json(),{status:'revoked'});
  assert.equal(calls,2);
 }finally{await app.close();}
});
