import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExternalDeliveryWebhookTransport}
 from '../src/modules/notifications/external-delivery-alert-webhook.js';

const valid={
 endpoint:'https://alerts.example.com/receiver',
 approvedHostname:'alerts.example.com',
 bearerToken:'secure-example-token-123',
 timeoutMs:5000,
};
const backlog={
 code:'DUE_BACKLOG',severity:'warning',observed:3,threshold:2,
} as const;

test('HTTPS webhook sends only bounded allowlisted aggregates with authentication',async()=>{
 let destination='',options:RequestInit|undefined;
 const transport=createExternalDeliveryWebhookTransport(valid,
  (async(input:string|URL|Request,init?:RequestInit)=>{destination=String(input);options=init;return {ok:true} as Response;}) as typeof fetch);
 await transport.send([backlog]);
 assert.equal(destination,valid.endpoint);
 assert.equal(options?.method,'POST');
 assert.equal(options?.redirect,'error');
 assert.deepEqual(options?.headers,{
  'content-type':'application/json','authorization':'Bearer '+valid.bearerToken,
 });
 assert.deepEqual(JSON.parse(String(options?.body)),{alerts:[backlog]});
 assert.equal(options?.signal?.aborted,false);
 assert.equal(JSON.stringify(options?.body).includes(valid.bearerToken),false);
});

test('HTTPS receiver configuration is explicit and restricted to approved endpoint',()=>{
 for(const patch of [
  {endpoint:'http://alerts.example.com/receiver'},
  {endpoint:'https://evil.example.com/receiver'},
  {endpoint:'https://alerts.example.com:8443/receiver'},
  {endpoint:'https://user:pass@alerts.example.com/receiver'},
  {endpoint:'https://alerts.example.com/receiver?secret=a'},
  {endpoint:'https://alerts.example.com/receiver#fragment'},
  {approvedHostname:'127.0.0.1',endpoint:'https://127.0.0.1/'},
  {approvedHostname:'localhost',endpoint:'https://localhost/'},
  {bearerToken:'short'},
  {bearerToken:'secure-example-token-123\nInjected: true'},
  {timeoutMs:999},{timeoutMs:30001},
 ]){
  assert.throws(()=>createExternalDeliveryWebhookTransport(
   {...valid,...patch}),/invalid_external_alert_webhook_config/);
 }
});

test('webhook rejects extra fields and accessor-backed alerts without sending',async()=>{
 let calls=0,reads=0;
 const transport=createExternalDeliveryWebhookTransport(valid,
  (async()=>{calls++;return {ok:true} as Response;}) as typeof fetch);
 await assert.rejects(transport.send([
  {...backlog,recipient:'person@example.com'} as never,
 ]),/invalid_external_alert_webhook_payload/);
 const trap=Object.defineProperty({...backlog},'observed',{
  get(){reads++;throw new Error('should not execute');},
 });
 await assert.rejects(transport.send([trap as never]),
  /invalid_external_alert_webhook_payload/);
 await assert.rejects(transport.send([]),/invalid_external_alert_webhook_payload/);
 assert.equal(calls,0);
 assert.equal(reads,0);
});

test('non-2xx responses and fetch failures are propagated, not treated as success',async()=>{
 const transport=createExternalDeliveryWebhookTransport(valid,
  (async()=>({ok:false,status:503} as Response)) as typeof fetch);
 await assert.rejects(transport.send([backlog]),
  /external_alert_webhook_delivery_failed/);
 const failure=new Error('network unreachable');
 const failed=createExternalDeliveryWebhookTransport(valid,
  (async()=>{throw failure;}) as typeof fetch);
 await assert.rejects(failed.send([backlog]),error=>error===failure);
});
