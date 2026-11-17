import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExternalDeliveryWebhookTransport}
 from '../src/modules/notifications/external-delivery-alert-webhook.js';
import {dispatchExternalDeliveryQueueAlerts}
 from '../src/modules/notifications/external-delivery-alert-dispatch.js';

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


test('webhook configuration rejects inherited and accessor-backed keys without executing getters',()=>{
 let getterCalls=0;
 for(const key of ['endpoint','approvedHostname','bearerToken','timeoutMs'] as const){
  const accessor=Object.defineProperty({...valid},key,{
   get(){getterCalls++;throw new Error('unsafe getter executed');},
  });
  assert.throws(()=>createExternalDeliveryWebhookTransport(accessor),
   /invalid_external_alert_webhook_config/);
  const inherited=Object.assign(Object.create({[key]:valid[key]}),valid);
  delete inherited[key];
  assert.throws(()=>createExternalDeliveryWebhookTransport(inherited),
   /invalid_external_alert_webhook_config/);
 }
 assert.equal(getterCalls,0);
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


test('webhook rejects duplicate codes and alerts below declared thresholds',async()=>{
 let sends=0;
 const transport=createExternalDeliveryWebhookTransport(valid,
  (async()=>{sends++;return {ok:true} as Response;}) as typeof fetch);
 for(const alerts of [
  [backlog,backlog],
  [{...backlog,observed:1}],
  [{...backlog,threshold:4}],
  [{code:'QUEUE_INCONSISTENT',severity:'critical',observed:0,threshold:1}],
  [{code:'QUEUE_INCONSISTENT',severity:'critical',observed:1,threshold:2}],
 ]){
  await assert.rejects(transport.send(alerts as never),
   /invalid_external_alert_webhook_payload/);
 }
 assert.equal(sends,0);
 await transport.send([backlog,{
  code:'EXPIRED_LEASES',severity:'warning',observed:1,threshold:1,
 }]);
 assert.equal(sends,1);
});

test('non-2xx responses and fetch failures are propagated, not treated as success',async()=>{
 const transport=createExternalDeliveryWebhookTransport(valid,
  (async()=>({ok:false,status:503} as Response)) as typeof fetch);
 await assert.rejects(transport.send([backlog]),
  /external_alert_webhook_delivery_failed/);
 const failure=new Error('network unreachable');
 const failed=createExternalDeliveryWebhookTransport(valid,
  (async()=>{throw failure;}) as typeof fetch);
 await assert.rejects(failed.send([backlog]),error=>{
  assert.equal((error as Error).message,'external_alert_webhook_transport_failed');
  assert.equal((error as Error).cause,undefined);
  assert.equal(String(error).includes(failure.message),false);
  return true;
 });
});

test('integration: SQL snapshot dispatches to HTTPS transport only above approved policy',async()=>{
 let sends=0;
 const bodies:unknown[]=[];
 const transport=createExternalDeliveryWebhookTransport(valid,
  (async(_input:string|URL|Request,init?:RequestInit)=>{
   sends++;
   bodies.push(JSON.parse(String(init?.body)));
   return {ok:true} as Response;
  }) as typeof fetch);
 const policy={pendingDueThreshold:2,expiredLeaseThreshold:2,terminalFailedThreshold:2};
 const empty={
  pending_due:'0',pending_scheduled:'0',leased_active:'0',
  leased_expired:'0',terminal_failed:'0',provider_accepted:'0',
  inconsistent:'0',total:'0',
 };
 await dispatchExternalDeliveryQueueAlerts({
  query:async()=>({rows:[empty]}),
 } as never,policy,transport);
 assert.equal(sends,0);
 const alerts=await dispatchExternalDeliveryQueueAlerts({
  query:async()=>({rows:[{...empty,pending_due:'2',total:'2'}]}),
 } as never,policy,transport);
 assert.equal(sends,1);
 assert.deepEqual(bodies,[{alerts:[{
  code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2,
 }]}]);
 assert.deepEqual(alerts,bodies.length===1?
  (bodies[0] as {alerts:typeof alerts}).alerts:[]);
});

test('webhook does not leak tokens or target URLs from rejected fetch exceptions',async()=>{
 const secret='sensitive-private-url-and-token';
 const transport=createExternalDeliveryWebhookTransport(valid,
  (async()=>{throw new Error(secret);}) as typeof fetch);
 await assert.rejects(transport.send([backlog]),error=>{
  assert.equal((error as Error).message,'external_alert_webhook_transport_failed');
  assert.equal((error as Error).cause,undefined);
  assert.equal(String(error).includes(secret),false);
  return true;
 });
});
