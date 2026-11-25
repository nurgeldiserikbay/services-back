import {Client} from 'pg';
import {assertInAppMonitorReadOnlyRole}
 from '../src/modules/notifications/in-app-monitor-permissions.js';
import {readInAppQueueHealth,assessInAppQueueHealth}
 from '../src/modules/notifications/in-app-queue-health.js';

/** Run ONLY from the operator-approved KZ-resident staging host.
 * No recipient, request or contact identifiers are read or logged.
 */
async function main():Promise<void>{
 if(process.env.SERVICES_ENABLE_IN_APP_MONITOR!=='enabled')
  throw Error('IN_APP monitor is disabled');
 const uri=process.env.DATABASE_URL;
 if(!uri)throw Error('Database not configured');
 const client=new Client({
  connectionString:uri,connectionTimeoutMillis:3500,statement_timeout:5000,
  application_name:'services-in-app-queue-monitor',
 });
 try{
  await client.connect();
  await client.query('BEGIN READ ONLY');
  let metrics;
  try{
   await client.query("SET LOCAL statement_timeout = '5s'");
   await assertInAppMonitorReadOnlyRole(client);
   metrics=await readInAppQueueHealth(client);
   await client.query('COMMIT');
  }catch{
   await client.query('ROLLBACK').catch(()=>{});
   throw Error('IN_APP observation failed');
  }
  const status=assessInAppQueueHealth(metrics);
  console.log('IN_APP aggregate health: pending='+metrics.pending+
   ', delivered='+metrics.delivered+
   ', oldest_pending_seconds='+metrics.oldestPendingSeconds+
   ', over_pending_threshold='+status.pendingOverLimit+
   ', over_age_threshold='+status.ageOverLimit);
  if(!status.healthy)process.exitCode=2;
 }finally{await client.end().catch(()=>{});}
}
main().catch(()=>{
 console.error('IN_APP monitor failed or is disabled');
 process.exitCode=1;
});
