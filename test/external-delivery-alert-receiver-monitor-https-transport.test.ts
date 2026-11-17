import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReceiverMonitorHttpsTransport}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-https-transport.js';
import {dispatchExternalAlertReceiverMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-dispatch.js';

const approved=()=>({
 endpoint:'https://alerts.example.org/receiver-monitor',
 approvedHostname:'alerts.example.org',
 bearerToken:'a'.repeat(48),
 timeoutMs:3000,
});
const breach=()=>[{code:'TERMINAL_FAILURES' as const,observed:2,threshold:1}];
const cols=['ready','retry_scheduled','leased_active','leased_expired',
 'terminal','acknowledged','inconsistent','total'] as const;
const db=()=>({query:async()=>({rows:[Object.fromEntries(cols.map(k=>
 [k,k==='terminal'||k==='total'?'2':'0']))]})}) as never;

test('explicit HTTPS sink serializes only allowlisted count metrics and blocks redirects',async()=>{
 let calls=0;
 const request=(async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  calls++;
  assert.equal(String(input),approved().endpoint);
  assert.equal(init?.method,'POST');
  assert.equal(init?.redirect,'error');
  assert.ok(init?.signal);
  const headers=init?.headers as Record<string,string>;
  assert.equal(headers.authorization,'Bearer '+approved().bearerToken);
  assert.equal(headers['content-type'],'application/json');
  assert.deepEqual(JSON.parse(String(init?.body)),{breaches:breach()});
  assert.equal(JSON.stringify(init?.body).includes('staging-secret-scope'),false);
  return {ok:true} as Response;
 }) as typeof fetch;
 const transport=createReceiverMonitorHttpsTransport(approved(),request);
 const results=await dispatchExternalAlertReceiverMonitoring(db(),
  'staging-secret-scope',
  {retryScheduled:1,leasedExpired:1,terminal:1,inconsistent:1},
  transport);
 assert.deepEqual(results,[{code:'TERMINAL_FAILURES',observed:2,threshold:1}]);
 assert.equal(calls,1);
 assert.equal(Object.isFrozen(transport),true);
});

test('HTTPS adapter rejects unsafe destinations, accessor config and malformed payloads before I/O',async()=>{
 let calls=0,accesses=0;
 const request=(async()=>{calls++;return {ok:true} as Response;}) as typeof fetch;
 const getter=Object.defineProperty(approved(),'endpoint',{
  get(){accesses++;throw Error('getter executed');},
 });
 for(const config of [
  {...approved(),endpoint:'http://alerts.example.org/receiver-monitor'},
  {...approved(),endpoint:'https://127.0.0.1/receiver-monitor',approvedHostname:'127.0.0.1'},
  {...approved(),endpoint:'https://localhost/receiver-monitor',approvedHostname:'localhost'},
  {...approved(),endpoint:'https://alerts.example.org:8443/receiver-monitor'},
  {...approved(),endpoint:'https://evil.example.org/receiver-monitor'},
  {...approved(),endpoint:'https://alerts.example.org/receiver-monitor?token=private'},
  {...approved(),endpoint:'https://admin:pass@alerts.example.org/receiver-monitor'},
  {...approved(),bearerToken:'weak'},
  {...approved(),timeoutMs:30000},
  {...approved(),extra:'secret'},
  getter,
 ])assert.throws(()=>createReceiverMonitorHttpsTransport(config as never,request),
  /invalid_external_alert_receiver_https_transport/);
 assert.equal(accesses,0);
 const sink=createReceiverMonitorHttpsTransport(approved(),request);
 await assert.rejects(sink.send([{...breach()[0],token:'private'}] as never),
  /invalid_external_alert_receiver_https_transport/);
 await assert.rejects(sink.send([{...breach()[0],observed:0}] as never),
  /invalid_external_alert_receiver_https_transport/);
 assert.equal(calls,0);
});

test('HTTP error, rejected fetch and redirect are fail-closed without leaking provider details',async()=>{
 for(const request of [
  (async()=>({ok:false,status:403,text:async()=> 'private server response'} as Response)),
  (async()=>{throw Error('provider secret inside transport failure');}),
 ]){
  const sink=createReceiverMonitorHttpsTransport(approved(),request as typeof fetch);
  await assert.rejects(sink.send(breach()),(error:unknown)=>{
   assert.equal((error as Error).message,'receiver_monitor_https_delivery_failed');
   return true;
  });
 }
});
