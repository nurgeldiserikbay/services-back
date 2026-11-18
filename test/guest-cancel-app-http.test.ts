import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {NestFactory} from '@nestjs/core';
import {AppModule} from '../src/modules/app.module.js';
import {DatabasePool} from '../src/platform/database/database.pool.js';

test('AppModule guest cancellation route is default-off and rejects unsigned requests',async()=>{
  const names=['SERVICES_ENABLE_GUEST_CANCEL_HTTP','GUEST_CANCEL_BFF_HMAC_KEY',
    'GUEST_REQUEST_HMAC_KEY','GUEST_CANCEL_LEDGER_HMAC_KEY'] as const;
  const previous=names.map(name=>process.env[name]);
  let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
  try{
    delete process.env[names[0]];
    app=await NestFactory.create(AppModule,{logger:false,rawBody:true});
    let calls=0;
    app.get(DatabasePool).transaction=async()=>{calls++;throw new Error('unexpected_db');};
    app.setGlobalPrefix('v1');
    await app.listen(0,'127.0.0.1');
    const address=app.getHttpServer().address();
    assert.ok(address&&typeof address!=='string');
    const url='http://127.0.0.1:'+address.port+'/v1/requests/'+randomUUID()+'/cancel';
    const post=()=>fetch(url,{method:'POST',headers:{
      'Content-Type':'application/json','Idempotency-Key':'GuestCancel_App_2026_12345',
      'Guest-Capability':randomBytes(32).toString('base64url'),
    },body:'{"expectedVersion":1}'});
    const disabled=await post();
    assert.equal(disabled.status,404);
    assert.match(disabled.headers.get('cache-control')??'',/no-store/);
    process.env[names[0]]='enabled';
    for(const name of names.slice(1))process.env[name]=randomBytes(32).toString('base64');
    const unsigned=await post();
    assert.equal(unsigned.status,404);
    assert.match(unsigned.headers.get('x-robots-tag')??'',/noindex/);
    assert.equal(calls,0);
  }finally{
    await app?.close();
    names.forEach((name,i)=>{
      if(previous[i]===undefined)delete process.env[name];
      else process.env[name]=previous[i];
    });
  }
});
