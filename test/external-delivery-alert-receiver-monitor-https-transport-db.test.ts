import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {acceptExternalDeliveryAlertIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-ingress.js';
import {claimExternalAlertReceiverIngress}
 from '../src/modules/notifications/external-delivery-alert-receiver-claim.js';
import {recordExternalAlertReceiverDeliveryFailure}
 from '../src/modules/notifications/external-delivery-alert-receiver-failure.js';
import {createReceiverMonitorHttpsTransport}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-https-transport.js';
import {dispatchConfiguredExternalAlertReceiverMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-configured-dispatch.js';

const thresholds=(terminal:string)=>({
 retryScheduled:'1',leasedExpired:'1',terminal,inconsistent:'1',
});
const approved=()=>({
 endpoint:'https://alerts.example.org/receiver-monitor',
 approvedHostname:'alerts.example.org',
 bearerToken:'s'.repeat(48),
 timeoutMs:2000,
});

test('PostgreSQL configured receiver dispatch uses only count-only HTTPS payload, with no real network',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const suffix=randomUUID().replaceAll('-','').slice(0,18);
 const scope='https-pg-'+suffix;
 const other='https-pg-other-'+suffix;
 const key=(char:string)=>'services-alert-v2-'+char.repeat(64);
 const alerts=[{code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2}] as const;
 let requests=0;
 const sentBodies:string[]=[];
 const mockedRequest=(async(url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  requests++;
  assert.equal(String(url),approved().endpoint);
  assert.equal(init?.method,'POST');
  assert.equal(init?.redirect,'error');
  assert.ok(init?.signal);
  const headers=init?.headers as Record<string,string>;
  assert.equal(headers.authorization,'Bearer '+approved().bearerToken);
  sentBodies.push(String(init?.body));
  return {ok:true} as Response;
 }) as typeof fetch;
 const transport=createReceiverMonitorHttpsTransport(approved(),mockedRequest);
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(db,scope,key('a'),alerts),'accepted');
  assert.equal(await acceptExternalDeliveryAlertIngress(db,other,key('b'),alerts),'accepted');
  const lease=await claimExternalAlertReceiverIngress(db,scope,1,30000);
  assert.equal(lease.length,1);
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,scope,lease[0].id,lease[0].token,
   {baseDelayMs:60000,maxDelayMs:60000,maxAttempts:1}),'terminal');

  assert.deepEqual(await dispatchConfiguredExternalAlertReceiverMonitoring(
   db,scope,thresholds('2'),transport),[]);
  assert.deepEqual(await dispatchConfiguredExternalAlertReceiverMonitoring(
   db,other,thresholds('1'),transport),[]);
  assert.equal(requests,0);

  const breached=await dispatchConfiguredExternalAlertReceiverMonitoring(
   db,scope,thresholds('1'),transport);
  assert.deepEqual(breached,[{
   code:'TERMINAL_FAILURES',observed:1,threshold:1,
  }]);
  assert.equal(requests,1);
  assert.deepEqual(JSON.parse(sentBodies[0]),{
   breaches:[{code:'TERMINAL_FAILURES',observed:1,threshold:1}],
  });
  for(const privateValue of [scope,other,lease[0].id,lease[0].token,key('a')])
   assert.equal(sentBodies[0].includes(privateValue),false);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('HTTPS sink rejects transport failure without logging provider error details',async()=>{
 const mockFetch=(async()=>{
  throw new Error('internal hostname and bearer token must remain hidden');
 }) as typeof fetch;
 const transport=createReceiverMonitorHttpsTransport(approved(),mockFetch);
 await assert.rejects(transport.send([{
  code:'TERMINAL_FAILURES',observed:1,threshold:1,
 }]),(error:unknown)=>{
  assert.equal((error as Error).message,'receiver_monitor_https_delivery_failed');
  return true;
 });
});
