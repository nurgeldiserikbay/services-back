import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {GuestCancelHttpController} from '../src/modules/requests/guest-cancel-http.controller.js';
import {GuestCancellationService} from '../src/modules/requests/guest-cancel.service.js';

test('real Nest HTTP server preserves raw cancellation body and rejects unsigned mutation',async()=>{
  const names=['SERVICES_ENABLE_GUEST_CANCEL_HTTP','GUEST_CANCEL_BFF_HMAC_KEY',
    'GUEST_REQUEST_HMAC_KEY','GUEST_CANCEL_LEDGER_HMAC_KEY'] as const;
  const old=names.map(name=>process.env[name]);
  const signingKey=randomBytes(32),id=randomUUID();
  const capability=randomBytes(32).toString('base64url');
  const key='GuestCancel_HTTP_2026_123456';
  const body='{"expectedVersion":1}';
  let calls=0;
  const service={cancelIdempotently:async(...args:unknown[])=>{
    calls++;
    assert.deepEqual(args,[id,capability,1,key]);
    return {id,state:'cancelled_by_customer',version:2};
  }};
  @Module({controllers:[GuestCancelHttpController],
    providers:[{provide:GuestCancellationService,useValue:service}]})
  class TestModule{}
  let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
  try{
    process.env[names[0]]='enabled';
    process.env[names[1]]=signingKey.toString('base64');
    process.env[names[2]]=randomBytes(32).toString('base64');
    process.env[names[3]]=randomBytes(32).toString('base64');
    app=await NestFactory.create(TestModule,{logger:false,rawBody:true});
    app.setGlobalPrefix('v1');
    await app.listen(0,'127.0.0.1');
    const address=app.getHttpServer().address();
    assert.ok(address&&typeof address!=='string');
    const url='http://127.0.0.1:'+address.port+'/v1/requests/'+id+'/cancel';
    const timestamp=String(Date.now());
    const proof='v1.'+timestamp+'.'+createHmac('sha256',signingKey)
      .update(JSON.stringify(['services-guest-cancel-bff:v1',timestamp,'POST',
        '/v1/requests/'+id+'/cancel',body,key,capability]),'utf8').digest('hex');
    const headers={'Content-Type':'application/json','Guest-Capability':capability,
      'Idempotency-Key':key,'X-Services-Guest-Cancel-Proof':proof};
    const post=(payload=body,h:Record<string,string>=headers)=>
      fetch(url,{method:'POST',headers:h,body:payload,redirect:'manual'});
    const unsigned=await post(body,{'Content-Type':'application/json',
      'Guest-Capability':capability,'Idempotency-Key':key});
    assert.equal(unsigned.status,404);
    assert.match(unsigned.headers.get('cache-control')??'',/no-store/);
    assert.equal((await post('{"expectedVersion":2}')).status,404);
    assert.equal((await post('{"expectedVersion":1,"expectedVersion":1}')).status,404);
    assert.equal((await post(' '+body)).status,404);
    assert.equal(calls,0);
    const good=await post();
    assert.equal(good.status,200,'signed request must reach injected service; calls='+calls);
    assert.deepEqual(await good.json(),{id,state:'cancelled_by_customer',version:2});
    assert.match(good.headers.get('x-robots-tag')??'',/noindex/);
    assert.equal(calls,1);
    process.env[names[0]]='disabled';
    assert.equal((await post()).status,404);
    assert.equal(calls,1);
  }finally{
    await app?.close();
    names.forEach((name,i)=>{
      if(old[i]===undefined)delete process.env[name];
      else process.env[name]=old[i];
    });
  }
});
