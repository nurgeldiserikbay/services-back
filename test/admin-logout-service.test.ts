import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PlatformAdminLogoutService} from '../src/modules/admin/admin-logout.service.js';
import {issueAdminSessionToken,hashAdminSessionToken} from '../src/modules/admin/admin-session-token.js';

const key=randomBytes(32);
const token=issueAdminSessionToken(key).token;

test('admin logout defaults off and never opens a database transaction',async()=>{
 const old=process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
 let called=0;
 try{
  delete process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
  const service=new PlatformAdminLogoutService({transaction:async()=>{called++;}} as never);
  await assert.rejects(service.logout('Bearer '+token),{status:401});
  assert.equal(called,0);
 }finally{
  if(old===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP=old;
 }
});

test('enabled admin logout revokes exact token hash within a transaction',async()=>{
 const oldFlag=process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
 const oldKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 try{
  process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=key.toString('base64');
  let transactions=0;
  const db={transaction:async(work:(client:unknown)=>Promise<unknown>)=>{
   transactions++;
   return work({query:async(sql:string,params:unknown[])=>{
    assert.match(sql,/UPDATE platform_admin_sessions/);
    assert.deepEqual(params[0],hashAdminSessionToken(token,key));
    assert.notEqual(params[0],token);
    return {rows:[{id:randomUUID()}]};
   }});
  }};
  const service=new PlatformAdminLogoutService(db as never);
  assert.equal(await service.logout('Bearer '+token),undefined);
  assert.equal(transactions,1);
  await assert.rejects(service.logout('Bearer bad'),{status:401});
  assert.equal(transactions,1);
 }finally{
  if(oldFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP=oldFlag;
  if(oldKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=oldKey;
 }
});


test('admin logout denies database failure and malformed driver responses',async()=>{
 const oldFlag=process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
 const oldKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 try{
  process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP='enabled';
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=key.toString('base64');
  for(const query of [
   async()=>{throw new Error('private database credentials');},
   async()=>({rows:[{id:'not-a-uuid'}]}),
   async()=>({rows:[{id:randomUUID()},{id:randomUUID()}]}),
  ]){
   const service=new PlatformAdminLogoutService({
    transaction:async(work:(client:unknown)=>Promise<unknown>)=>work({query}),
   } as never);
   await assert.rejects(service.logout('Bearer '+token),{status:401});
  }
 }finally{
  if(oldFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP=oldFlag;
  if(oldKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=oldKey;
 }
});


test('admin logout controller explicitly returns HTTP 200 and disables caching',()=>{
 const source=readFileSync('src/modules/admin/admin-logout.controller.ts','utf8');
 assert.match(source,/@Post\('logout'\)\s*@HttpCode\(200\)/);
 assert.match(source,/@Header\('Cache-Control','private, no-store, max-age=0'\)/);
 assert.match(source,/return \{status:'revoked'\}/);
});
