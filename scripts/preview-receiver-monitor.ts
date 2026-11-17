import {Client} from 'pg';
import {readReceiverMonitorPreviewSettings}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-preview-settings.js';
import {previewConfiguredExternalAlertReceiverMonitoring}
 from '../src/modules/notifications/external-delivery-alert-receiver-monitor-preview.js';

/**
 * Explicit, operator-only staging preview. No outbound transport, HTTP route,
 * periodic execution or logged secrets. Never interpret this as staging sign-off.
 */
async function main():Promise<void>{
 const {receiverScope,thresholds}=readReceiverMonitorPreviewSettings(process.env);
 const connectionString=process.env.DATABASE_URL;
 if(typeof connectionString!=='string'||connectionString.length===0)
  throw new Error('missing_database_url');
 const db=new Client({
  connectionString,connectionTimeoutMillis:4000,statement_timeout:8000,
  query_timeout:8000,
 });
 try{
  await db.connect();
  await db.query('BEGIN READ ONLY');
  const breaches=await previewConfiguredExternalAlertReceiverMonitoring(
   db,receiverScope,thresholds);
  await db.query('COMMIT');
  // The output has only a status discriminator and allowlisted numeric signals.
  process.stdout.write(JSON.stringify({mode:'dry-run',breaches})+'\n');
 }finally{
  await db.end().catch(()=>{});
 }
}

main().catch(()=>{
 // Do not log driver errors: they may embed connection strings or SQL values.
 process.stderr.write('receiver_monitor_preview_failed\n');
 process.exitCode=1;
});
