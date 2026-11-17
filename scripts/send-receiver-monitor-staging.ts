import {Client} from 'pg';
import {readReceiverMonitorSendSettings}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-send-settings.js';
import {createReceiverMonitorHttpsTransport}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-https-transport.js';
import {dispatchOneShotReceiverStagingMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-staging-dispatch.js';
import {readReceiverMonitoringOptionalCooldown}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-cooldown-transport.js';

/**
 * Operator-invoked, staging-only one-shot dispatch.
 * No cron, public HTTP route, default recipient, threshold or secret.
 * Explicit destination and two acknowledgments are validated before SQL.
 * This script must run under staging-only service credentials and egress ACLs.
 */
async function main():Promise<void>{
 const settings=readReceiverMonitorSendSettings(process.env);
 const cooldownSeconds=readReceiverMonitoringOptionalCooldown(process.env);
 const connectionString=process.env.DATABASE_URL;
 if(typeof connectionString!=='string'||connectionString.length===0)
  throw new Error('missing_database_url');
 const transport=createReceiverMonitorHttpsTransport({
  endpoint:settings.endpoint,
  approvedHostname:settings.approvedHostname,
  bearerToken:settings.bearerToken,
  timeoutMs:settings.timeoutMs,
 });
 const db=new Client({
  connectionString,connectionTimeoutMillis:4000,statement_timeout:8000,
  query_timeout:8000,
 });
 try{
  await db.connect();
  // The observer uses a single scoped count query; no transaction lock
  // should remain open while the HTTP transport is awaited.
  const counts=await dispatchOneShotReceiverStagingMonitoring(
   db,settings.receiverScope,settings.thresholds,transport,cooldownSeconds);
  process.stdout.write(JSON.stringify({
   mode:'one-shot-staging-send',
   ...counts,
  })+'\n');
 }finally{
  await db.end().catch(()=>{});
 }
}

main().catch(()=>{
 // Never print provider response bodies, SQL errors, the token or DB URL.
 process.stderr.write('receiver_monitor_staging_send_failed\n');
 process.exitCode=1;
});
