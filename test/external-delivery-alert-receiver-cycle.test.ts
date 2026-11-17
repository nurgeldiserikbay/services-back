import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {deliverOneExternalAlertReceiverIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-cycle.js';

const scope='staging-kz';
const id=randomUUID(),token=randomUUID();
const alert={code:'DUE_BACKLOG',severity:'warning',observed:3,threshold:2} as const;
const claimed={id,lease_token:token,alerts:[alert]};

test('receiver worker sends only claimed aggregates, then ACKs with its token',async()=>{
 const calls:{sql:string;args:unknown[]}[]=[];
 const db={query:async(sql:string,args:unknown[])=>{
  calls.push({sql,args});
  return calls.length===1?{rows:[claimed]}:{rows:[{id}]};
 }} as never;
 let sent:unknown;
 const transport={send:async(alerts:unknown)=>{sent=alerts;}};
 assert.equal(await deliverOneExternalAlertReceiverIngress(
  db,scope,30000,transport),'acknowledged');
 assert.deepEqual(sent,[alert]);
 assert.equal(Object.isFrozen(sent),true);
 assert.equal(calls.length,2);
 assert.deepEqual(calls[0].args,[scope,1,30000]);
 assert.deepEqual(calls[1].args,[id,scope,token]);
});

test('worker does not ACK on transport failure; item remains for expiry retry',async()=>{
 let sqlCount=0;
 const db={query:async()=>{sqlCount++;return {rows:[claimed]};}} as never;
 const failure=new Error('provider rejected');
 await assert.rejects(deliverOneExternalAlertReceiverIngress(
  db,scope,30000,{send:async()=>{throw failure;}}),e=>e===failure);
 assert.equal(sqlCount,1);
});

test('worker treats an expired or replaced lease ACK as stale, not success',async()=>{
 let calls=0;
 const db={query:async()=>{
  calls++;
  return calls===1?{rows:[claimed]}:{rows:[]};
 }} as never;
 let sends=0;
 assert.equal(await deliverOneExternalAlertReceiverIngress(
  db,scope,30000,{send:async()=>{sends++;}}),'stale');
 assert.equal(sends,1);
 assert.equal(calls,2);
});

test('worker does not call transport when no item exists',async()=>{
 let sends=0;
 const db={query:async()=>({rows:[]})} as never;
 assert.equal(await deliverOneExternalAlertReceiverIngress(
  db,scope,30000,{send:async()=>{sends++;}}),'empty');
 assert.equal(sends,0);
});

test('worker rejects malformed durable payload without sending or ACK',async()=>{
 const badCases=[
  [{...alert,email:'private@example.org'}],
  [Object.defineProperty({...alert},'observed',{get(){throw new Error('getter');}})],
  [{...alert,observed:1}],
  [alert,alert],
  [],
 ];
 for(const alerts of badCases){
  let calls=0,sends=0;
  const db={query:async()=>{
   calls++;
   return {rows:[{id,lease_token:token,alerts}]};
  }} as never;
  await assert.rejects(deliverOneExternalAlertReceiverIngress(
   db,scope,30000,{send:async()=>{sends++;}}),
   /invalid_external_alert_receiver_(?:payload|database)/);
  assert.equal(calls,1);
  assert.equal(sends,0);
 }
});

test('worker rejects accessor-backed or inherited sender before claim',async()=>{
 let calls=0,reads=0;
 const db={query:async()=>{calls++;throw new Error('unexpected');}} as never;
 const evil=Object.defineProperty({},'send',{
  get(){reads++;throw new Error('getter called');},
 });
 await assert.rejects(deliverOneExternalAlertReceiverIngress(
  db,scope,30000,evil as never),/invalid_external_alert_receiver_transport/);
 await assert.rejects(deliverOneExternalAlertReceiverIngress(
  db,scope,30000,Object.create({send:async()=>{}}) as never),
  /invalid_external_alert_receiver_transport/);
 assert.equal(calls,0);
 assert.equal(reads,0);
});
