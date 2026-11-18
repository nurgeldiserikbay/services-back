import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {NotFoundException,ConflictException} from '@nestjs/common';
import {GuestCancelHttpController} from '../src/modules/requests/guest-cancel-http.controller.js';
import {GuestCancellationRejected} from '../src/modules/requests/guest-cancel.transaction.js';
import type {GuestCancellationService} from '../src/modules/requests/guest-cancel.service.js';

test('unmounted cancellation controller requires signed command and distinct keys',async()=>{
  const names=['SERVICES_ENABLE_GUEST_CANCEL_HTTP','GUEST_CANCEL_BFF_HMAC_KEY',
    'GUEST_REQUEST_HMAC_KEY','GUEST_CANCEL_LEDGER_HMAC_KEY'] as const;
  const prior=names.map(name=>process.env[name]);
  const key=randomBytes(32),id=randomUUID(),capability=randomBytes(32).toString('base64url');
  const idempotencyKey='CancelGuest_2026_12345678',rawBody='{"expectedVersion":1}';
  const timestamp=String(Date.now());
  const proof='v1.'+timestamp+'.'+createHmac('sha256',key).update(JSON.stringify([
    'services-guest-cancel-bff:v1',timestamp,'POST','/v1/requests/'+id+'/cancel',
    rawBody,idempotencyKey,capability]),'utf8').digest('hex');
  const request={rawBody:Buffer.from(rawBody),rawHeaders:[
    'Content-Type','application/json','Guest-Capability',capability,
    'Idempotency-Key',idempotencyKey,'X-Services-Guest-Cancel-Proof',proof,
  ]};
  let calls=0,reason:'conflict'|'unavailable'|undefined;
  const service={cancelIdempotently:async(...args:unknown[])=>{
    calls++;
    assert.deepEqual(args,[id,capability,1,idempotencyKey]);
    if(reason)throw new GuestCancellationRejected(reason);
    return {id,state:'cancelled_by_customer',version:2,privateContact:'hidden'};
  }} as unknown as GuestCancellationService;
  const controller=new GuestCancelHttpController(service);
  try{
    delete process.env[names[0]];
    await assert.rejects(controller.cancel(id,request),NotFoundException);
    process.env[names[0]]='enabled';
    process.env[names[1]]=key.toString('base64');
    process.env[names[2]]=randomBytes(32).toString('base64');
    process.env[names[3]]=randomBytes(32).toString('base64');
    for(const bad of [
      {rawBody:Buffer.from('{"expectedVersion":2}')},
      {rawBody:Buffer.from('{"expectedVersion":1,"expectedVersion":1}')},
      {rawBody:undefined},
      {rawBody:Buffer.alloc(129)},
      {rawHeaders:[...request.rawHeaders,'Guest-Capability',capability]},
      {rawHeaders:['Content-Type','application/json']},
    ]){
      await assert.rejects(controller.cancel(id,{...request,...bad}),NotFoundException);
    }
    const pepper=process.env[names[2]];
    process.env[names[2]]=key.toString('base64');
    await assert.rejects(controller.cancel(id,request),NotFoundException);
    process.env[names[2]]=pepper;
    assert.equal(calls,0);
    assert.deepEqual(await controller.cancel(id,request),
      {id,state:'cancelled_by_customer',version:2});
    reason='conflict';
    await assert.rejects(controller.cancel(id,request),ConflictException);
    reason='unavailable';
    await assert.rejects(controller.cancel(id,request),NotFoundException);
    assert.equal(calls,3);
  }finally{
    names.forEach((name,i)=>{
      if(prior[i]===undefined)delete process.env[name];
      else process.env[name]=prior[i];
    });
  }
});
