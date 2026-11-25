import {Client} from 'pg';
import {runOneInAppNotificationBatch} from '../src/modules/notifications/in-app-worker.js';

/** Run as a separately approved periodic job; never from API boot.
 * A single invocation handles at most 25 events and 25 in-app deliveries.
 * No SMS/email/push provider is contacted.
 */
async function main():Promise<void>{
 if(process.env.SERVICES_ENABLE_IN_APP_NOTIFICATION_WORKER!=='enabled')
  throw new Error('In-app worker is disabled');
 if(process.env.SERVICES_NOTIFICATION_EXTERNAL_DELIVERY==='enabled')
  throw new Error('IN_APP-only worker cannot run in external-delivery mode');
 const url=process.env.DATABASE_URL;
 if(!url)throw new Error('Database not configured');
 const client=new Client({
  connectionString:url,connectionTimeoutMillis:3500,statement_timeout:8000,
  application_name:'services-in-app-notification-worker',
 });
 try{
  await client.connect();
  const result=await runOneInAppNotificationBatch(client,25);
  console.log('In-app batch committed: staged '+result.deliveryRowsStaged+
   ', materialized '+result.inAppDeliveriesMaterialized+
   ', events examined '+result.outboxEventsVisited);
 }finally{
  await client.end().catch(()=>{});
 }
}
main().catch(()=>{
 console.error('In-app notification batch failed or is disabled');
 process.exitCode=1;
});
