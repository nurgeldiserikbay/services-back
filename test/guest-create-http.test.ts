import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {
  ConflictException,ForbiddenException,NotFoundException,
} from '@nestjs/common';
import {GuestCreateHttpController}
  from '../src/modules/guest-requests/guest-create-http.controller.js';
import {GuestRequestRejected} from '../src/modules/guest-requests/guest-request.transaction.js';
import type {GuestRequestService} from '../src/modules/guest-requests/guest-request.service.js';

const proof=randomBytes(32).toString('base64url');
const idempotencyKey='guest_submit_once_20261104';
const body={service_offer_id:randomUUID(),note:'Private request',
  consent_to_contact:true};
const created={id:randomUUID(),state:'pending' as const,
  requestCapability:randomBytes(32).toString('base64url'),
  expiresAt:'2026-11-05T08:00:00.000Z'};

async function withFlag<T>(value:string|undefined,work:()=>Promise<T>):Promise<T>{
  const old=process.env.SERVICES_ENABLE_GUEST_CREATE_HTTP;
  try{
    if(value===undefined)delete process.env.SERVICES_ENABLE_GUEST_CREATE_HTTP;
    else process.env.SERVICES_ENABLE_GUEST_CREATE_HTTP=value;
    return await work();
  }finally{
    if(old===undefined)delete process.env.SERVICES_ENABLE_GUEST_CREATE_HTTP;
    else process.env.SERVICES_ENABLE_GUEST_CREATE_HTTP=old;
  }
}

test('guest creation HTTP is disabled by default without invoking domain service',async()=>{
  let calls=0;
  const requests={
    createFromVerifiedContact:async()=>{calls++;return created;},
  } as unknown as GuestRequestService;
  const http=new GuestCreateHttpController(requests);
  for(const flag of [undefined,'true','1','ENABLED','disabled']){
    await withFlag(flag,async()=>{
      await assert.rejects(http.create(body,proof,idempotencyKey),NotFoundException);
    });
  }
  assert.equal(calls,0);
});

test('enabled HTTP forwards proof to service and maps committed reply to OpenAPI',async()=>{
  const requests={
    createFromVerifiedContact:async(input:unknown,token:unknown,key:unknown)=>{
      assert.equal(input,body);
      assert.equal(token,proof);
      assert.equal(key,idempotencyKey);
      return {...created,privateContact:'never serialize',sellerId:randomUUID()};
    },
  } as unknown as GuestRequestService;
  const http=new GuestCreateHttpController(requests);
  const result=await withFlag('enabled',()=>http.create(body,proof,idempotencyKey));
  assert.deepEqual(result,{
    id:created.id,state:'pending',request_capability:created.requestCapability,
    expires_at:created.expiresAt,
  });
  assert.deepEqual(Object.keys(result),
    ['id','state','request_capability','expires_at']);
  assert.equal(JSON.stringify(result).includes('never serialize'),false);
});

test('guest proof, unavailable offer and idempotency conflicts are not enumerated',async()=>{
  for(const reason of ['invalid_proof','unavailable_offer','idempotency_conflict'] as const){
    const requests={
      createFromVerifiedContact:async()=>{throw new GuestRequestRejected(reason);},
    } as unknown as GuestRequestService;
    const http=new GuestCreateHttpController(requests);
    await withFlag('enabled',async()=>{
      await assert.rejects(http.create(body,proof,idempotencyKey),
        reason==='idempotency_conflict'?ConflictException:ForbiddenException);
    });
  }
});

test('controller declares POST 201 with private no-store and noindex',()=>{
  const method=GuestCreateHttpController.prototype.create;
  const status=Reflect.getMetadata('__httpCode__',method);
  assert.equal(status,201);
  assert.equal(Reflect.getMetadata('path',GuestCreateHttpController),'guest-requests');
  const headers=Reflect.getMetadata('__headers__',method) as
    Array<{name:string;value:string}>;
  const map=new Map(headers.map(x=>[x.name.toLowerCase(),x.value]));
  assert.match(map.get('cache-control')??'',/no-store/);
  assert.equal(map.get('pragma'),'no-cache');
  assert.match(map.get('x-robots-tag')??'',/noindex/);
});
