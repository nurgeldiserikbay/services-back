import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {Controller,Module,Post,Req,Res} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {parseRequeueHttpPreflight}
 from '../src/modules/notifications/dead-letter-requeue-http-preflight.js';

// Isolated Nest HTTP harness ONLY. Never register this test controller in AppModule.
// The future privileged route still requires real auth, DB authorization,
// transaction-bound audit and trusted proxy/ingress deployment approval.
test('isolated Nest requeue HTTP boundary denies cross-site or forged input before work',async()=>{
 const csrf=randomBytes(32).toString('base64url');
 const deliveryId=randomUUID(),key=randomUUID();
 let accepted=0,workCalls=0;
 @Controller('private-test/notifications')
 class IsolatedRequeueBoundary{
  @Post('requeue')
  async handle(@Req() req:IncomingMessage,@Res() res:ServerResponse){
   res.setHeader('cache-control','no-store');
   try{
    let raw='';
    for await(const part of req){
     raw+=part.toString('utf8');
     if(Buffer.byteLength(raw,'utf8')>32)throw new Error('body_too_large');
    }
    const command=parseRequeueHttpPreflight({
     deliveryId:new URL(req.url??'/', 'http://localhost').searchParams.get('delivery'),
     requeueKeyHeader:req.headers['x-requeue-key'],
     rawBody:raw,
     csrfHeader:req.headers['x-csrf-token'],
     sessionExpectedCsrf:csrf,
     expectedOrigin:'https://admin.example.kz',
     origin:req.headers.origin,
     fetchSite:req.headers['sec-fetch-site'],
     contentType:req.headers['content-type'],
     transportProtocol:'https:', // trusted ingress setting, never forwarded header
    });
    assert.deepEqual(command,{deliveryId,requeueKey:key});
    accepted++;
    res.statusCode=204;
    res.end();
   }catch{
    res.statusCode=403;
    res.end();
   }
  }
 }
 @Module({controllers:[IsolatedRequeueBoundary]})
 class IsolatedRequeueModule{}
 const app=await NestFactory.create(IsolatedRequeueModule,{
  logger:false,bodyParser:false,
 });
 try{
  await app.listen(0,'127.0.0.1');
  const addr=app.getHttpServer().address();
  assert.ok(addr&&typeof addr!=='string');
  const url=`http://127.0.0.1:${addr.port}/private-test/notifications/requeue?delivery=${deliveryId}`;
  const headers={
   'content-type':'application/json',
   'origin':'https://admin.example.kz',
   'sec-fetch-site':'same-origin',
   'x-requeue-key':key,
   'x-csrf-token':csrf,
  };
  const send=(overrides:Record<string,string>={},body='{}')=>
   fetch(url,{method:'POST',headers:{...headers,...overrides},body});
  const good=await send();
  assert.equal(good.status,204);
  assert.match(good.headers.get('cache-control')??'',/no-store/);
  const invalid=[
   {'origin':'https://malicious.example.kz'},
   {'origin':'http://admin.example.kz'},
   {'sec-fetch-site':'cross-site'},
   {'sec-fetch-site':'same-site'},
   {'x-csrf-token':randomBytes(32).toString('base64url')},
   {'x-csrf-token':''},
   {'x-requeue-key':'bad'},
   {'content-type':'text/plain'},
   {'content-type':'application/x-www-form-urlencoded'},
  ];
  for(const override of invalid){
   const response=await send(override);
   assert.equal(response.status,403,JSON.stringify(override));
   assert.match(response.headers.get('cache-control')??'',/no-store/);
  }
  for(const raw of ['{"actor":"owner"}','{"organizationId":"x"}',
   '{"providerVerdict":"NOT_FOUND"}','[]','{}{}']){
   const response=await send({},raw);
   assert.equal(response.status,403,raw);
  }
  const query=await fetch(url.replace(deliveryId,'invalid'),{
   method:'POST',headers,body:'{}',
  });
  assert.equal(query.status,403);
  assert.equal(accepted,1);
  // This isolated test must never invoke the production DB/provider worker.
  assert.equal(workCalls,0);
 }finally{
  await app.close();
 }
});
