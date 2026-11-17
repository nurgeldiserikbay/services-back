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
import {dispatchConfiguredExternalAlertReceiverMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-configured-dispatch.js';
import {createReceiverMonitorHttpsTransport}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-https-transport.js';

const config=(terminal:string)=>({
 retryScheduled:'1',leasedExpired:'1',terminal,inconsistent:'1',
});
const destination=()=>({
 endpoint:'https://alerts.example.org/receiver-monitor',
 approvedHostname:'alerts.example.org',
 bearerToken:'a'.repeat(48),
 timeoutMs:2500,
});

test('PostgreSQL receiver monitoring delivers only approved count metrics through mocked HTTPS transport',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const suffix=randomUUID().replaceAll('-','').slice(0,18);
 const scope='https-monitor-'+suffix;
 const other='https-other-'+suffix;
 const key=(char:string)=>'services-alert-v2-'+char.repeat(64);
 const alerts=[{code:'DUE_BACKLOG',severity:'warning',observed:2,threshold:2}] as const;
 const requests:unknown[]=[];
 const http=(async(_url:Parameters<typeof fetch>[0],options?:RequestInit)=>{
  requests.push({
   url:String(_url),method:options?.method,redirect:options?.redirect,
   auth:(options?.headers as Record<string,string>)?.authorization,
   body:JSON.parse(String(options?.body)),
  });
  return {ok:true} as Response;
 }) as typeof fetch;
 const transport=createReceiverMonitorHttpsTransport(destination(),http);
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(db,scope,key('a'),alerts),'accepted');
  assert.equal(await acceptExternalDeliveryAlertIngress(db,other,key('b'),alerts),'accepted');
  const claim=await claimExternalAlertReceiverIngress(db,scope,1,30000);
  assert.equal(claim.length,1);
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,scope,claim[0].id,claim[0].token,
   {baseDelayMs:60000,maxDelayMs:60000,maxAttempts:1}),'terminal');
  assert.deepEqual(await dispatchConfiguredExternalAlertReceiverMonitoring(
   db,scope,config('2'),transport),[]);
  assert.equal(requests.length,0);
  const breached=await dispatchConfiguredExternalAlertReceiverMonitoring(
   db,scope,config('1'),transport);
  assert.deepEqual(breached,[{code:'TERMINAL_FAILURES',observed:1,threshold:1}]);
  assert.deepEqual(requests,[{
   url:destination().endpoint,method:'POST',redirect:'error',
   auth:'Bearer '+destination().bearerToken,
   body:{breaches:[{code:'TERMINAL_FAILURES',observed:1,threshold:1}]},
  }]);
  assert.deepEqual(await dispatchConfiguredExternalAlertReceiverMonitoring(
   db,other,config('1'),transport),[]);
  assert.equal(requests.length,1);
  const json=JSON.stringify(requests[0]);
  for(const secret of [scope,other,claim[0].id,claim[0].token,key('a')])
   assert.equal(json.includes(secret),false);
  await assert.rejects(dispatchConfiguredExternalAlertReceiverMonitoring(
   db,scope,config('0'),transport),
   /invalid_external_alert_receiver_monitor_config/);
  assert.equal(requests.length,1);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});

test('PostgreSQL receiver monitor propagates mocked HTTPS outage without false delivery',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const scope='https-outage-'+randomUUID().replaceAll('-','').slice(0,18);
 const alerts=[{code:'DUE_BACKLOG',severity:'warning',observed:1,threshold:1}] as const;
 try{
  assert.equal(await acceptExternalDeliveryAlertIngress(
   db,scope,'services-alert-v2-'+'c'.repeat(64),alerts),'accepted');
  const claim=await claimExternalAlertReceiverIngress(db,scope,1,30000);
  assert.equal(claim.length,1);
  assert.equal(await recordExternalAlertReceiverDeliveryFailure(
   db,scope,claim[0].id,claim[0].token,
   {baseDelayMs:60000,maxDelayMs:60000,maxAttempts:1}),'terminal');
  const http=(async()=>{throw Error('mocked provider body contains private data');}) as typeof fetch;
  const transport=createReceiverMonitorHttpsTransport(destination(),http);
  await assert.rejects(dispatchConfiguredExternalAlertReceiverMonitoring(
   db,scope,config('1'),transport),
   (error:unknown)=>{
    assert.equal((error as Error).message,'receiver_monitor_https_delivery_failed');
    return true;
   });
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
