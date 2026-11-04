import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {ForbiddenException,NotFoundException} from '@nestjs/common';
import {GuestRequestStatusHttpController}
  from '../src/modules/guest-requests/guest-request-status-http.controller.js';
import type {GuestRequestStatusService}
  from '../src/modules/guest-requests/guest-request-status.service.js';

const id=randomUUID();
const token=randomBytes(32).toString('base64url');
const status={id,service_offer_id:randomUUID(),state:'pending',version:1,
  created_at:'2026-11-04T08:00:00.000Z'};

test('guest status HTTP is disabled by default with zero data lookup',async()=>{
  const original=process.env.SERVICES_ENABLE_GUEST_STATUS_HTTP;
  delete process.env.SERVICES_ENABLE_GUEST_STATUS_HTTP;
  let called=0;
  const service=({getOwnStatus:async()=>{called++;return status;}}
    as unknown as GuestRequestStatusService);
  try{
    const controller=new GuestRequestStatusHttpController(service);
    await assert.rejects(controller.getOwnStatus(id,token),NotFoundException);
    assert.equal(called,0);
  }finally{
    if(original!==undefined)process.env.SERVICES_ENABLE_GUEST_STATUS_HTTP=original;
  }
});

test('only exact enabled value activates delegated READ_CANCEL guard',async()=>{
  const original=process.env.SERVICES_ENABLE_GUEST_STATUS_HTTP;
  let calls=0;
  const service={getOwnStatus:async(requestId:unknown,proof:unknown)=>{
    calls++;
    assert.equal(requestId,id);assert.equal(proof,token);
    return status;
  }} as unknown as GuestRequestStatusService;
  const controller=new GuestRequestStatusHttpController(service);
  try{
    for(const value of ['true','1','ENABLED','disabled']){
      process.env.SERVICES_ENABLE_GUEST_STATUS_HTTP=value;
      await assert.rejects(controller.getOwnStatus(id,token),NotFoundException);
    }
    assert.equal(calls,0);
    process.env.SERVICES_ENABLE_GUEST_STATUS_HTTP='enabled';
    assert.deepEqual(await controller.getOwnStatus(id,token),status);
    assert.equal(calls,1);
  }finally{
    if(original===undefined)delete process.env.SERVICES_ENABLE_GUEST_STATUS_HTTP;
    else process.env.SERVICES_ENABLE_GUEST_STATUS_HTTP=original;
  }
});

test('status HTTP does not invent guest rights or convert error to existence oracle',async()=>{
  const original=process.env.SERVICES_ENABLE_GUEST_STATUS_HTTP;
  process.env.SERVICES_ENABLE_GUEST_STATUS_HTTP='enabled';
  const controller=new GuestRequestStatusHttpController({
    getOwnStatus:async()=>{throw new ForbiddenException('Guest request unavailable');},
  } as unknown as GuestRequestStatusService);
  try{
    await assert.rejects(controller.getOwnStatus(randomUUID(),token),ForbiddenException);
    await assert.rejects(controller.getOwnStatus(id,undefined),ForbiddenException);
  }finally{
    if(original===undefined)delete process.env.SERVICES_ENABLE_GUEST_STATUS_HTTP;
    else process.env.SERVICES_ENABLE_GUEST_STATUS_HTTP=original;
  }
});

test('HTTP metadata prevents caches and indexing and requires guest header',()=>{
  const proto=GuestRequestStatusHttpController.prototype;
  const fn=proto.getOwnStatus;
  const headers=Reflect.getMetadata('__headers__',fn) as Array<{name:string;value:string}>;
  const map=new Map(headers.map(item=>[item.name.toLowerCase(),item.value]));
  assert.match(map.get('cache-control')??'',/no-store/);
  assert.equal(map.get('pragma'),'no-cache');
  assert.match(map.get('x-robots-tag')??'',/noindex/);
  assert.equal(Reflect.getMetadata('path',fn),':id');
  assert.equal(Reflect.getMetadata('path',GuestRequestStatusHttpController),'requests');
});
