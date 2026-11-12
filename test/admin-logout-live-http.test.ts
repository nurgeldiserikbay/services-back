import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {AppModule} from '../src/modules/app.module.js';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';

test('admin logout HTTP confirms revocation without cache or token disclosure',async()=>{
 const oldFlag=process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
 const oldKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 const pepper=randomBytes(32);
 const {token,tokenHash}=issueAdminSessionToken(pepper);
 let app:INestApplication|undefined;
 let updates=0;
 try{
  process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  app=await NestFactory.create(AppModule,{logger:false});
  const db=app.get(DatabasePool);
  db.transaction=async <T>(work:(client:PoolClient)=>Promise<T>):Promise<T>=>{
   const client={query:async(sql:string,params:unknown[])=>{
    assert.match(sql,/UPDATE platform_admin_sessions/);
    assert.equal(params[0],tokenHash);
    updates++;
    return {rows:[{id:randomUUID()}]};
   }} as unknown as PoolClient;
   return work(client);
  };
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const address=app.getHttpServer().address();
  assert.ok(address&&typeof address!=='string');
  const url=`http://127.0.0.1:${address.port}/v1/admin/session/logout`;
  const post=(header?:string)=>fetch(url,{
   method:'POST',headers:header===undefined?{}:{Authorization:header},redirect:'manual',
  });
  const valid=await post('Bearer '+token);
  assert.equal(valid.status,200);
  assert.match(valid.headers.get('cache-control')??'',/no-store/);
  assert.match(valid.headers.get('x-robots-tag')??'',/noindex/);
  assert.deepEqual(await valid.json(),{status:'revoked'});
  assert.equal(updates,1);
  for(const header of [undefined,'Basic '+token,'Bearer bad',
   'Bearer '+token+', Bearer '+token]){
   const denied=await post(header);
   assert.equal(denied.status,401,header);
   assert.ok(!(await denied.text()).includes(token));
   assert.equal(updates,1);
  }
 }finally{
  if(app)await app.close();
  if(oldFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP=oldFlag;
  if(oldKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=oldKey;
 }
});

test('admin logout HTTP stays unavailable when feature flag is disabled',async()=>{
 const previous=process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
 let app:INestApplication|undefined;
 try{
  delete process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
  app=await NestFactory.create(AppModule,{logger:false});
  const db=app.get(DatabasePool);
  let queried=false;
  db.transaction=async()=>{queried=true;throw new Error('unexpected database access');};
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const address=app.getHttpServer().address();
  assert.ok(address&&typeof address!=='string');
  const response=await fetch(
   `http://127.0.0.1:${address.port}/v1/admin/session/logout`,
   {method:'POST',headers:{Authorization:'Bearer '+issueAdminSessionToken(randomBytes(32)).token}},
  );
  assert.equal(response.status,401);
  assert.equal(queried,false);
 }finally{
  if(app)await app.close();
  if(previous===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP=previous;
 }
});
