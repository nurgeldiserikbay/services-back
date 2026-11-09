import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import {AppModule} from '../src/modules/app.module.js';

/**
 * Real loopback HTTP boundary, not a controller method call.
 * The privileged API must remain unexposed without an explicit rollout.
 * No admin credentials, provider secrets, or production data are required.
 */
test('platform moderation HTTP fails closed with private no-store responses',async()=>{
 const prior=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 let app:INestApplication|undefined;
 try{
  delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  app=await NestFactory.create(AppModule,{logger:false});
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const address=app.getHttpServer().address();
  assert.ok(address&&typeof address!=='string');
  const url=`http://127.0.0.1:${address.port}/v1/admin/moderation/cases`;
  const token=randomBytes(32).toString('base64url');
  for(const authorization of [undefined,'Bearer '+token]){
   const response=await fetch(url,{
    headers:authorization?{Authorization:authorization}:{},
    redirect:'manual',
   });
   assert.equal(response.status,401);
   assert.match(response.headers.get('cache-control')??'',/no-store/);
   assert.equal(response.headers.get('pragma'),'no-cache');
   assert.match(response.headers.get('x-robots-tag')??'',/noindex/);
   const body=await response.text();
   assert.ok(!body.includes(token),'response may not echo bearer proof');
   assert.ok(!body.includes('platform_admin_sessions'),'response may not leak schema details');
  }
 }finally{
  if(app)await app.close();
  if(prior===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=prior;
 }
});
