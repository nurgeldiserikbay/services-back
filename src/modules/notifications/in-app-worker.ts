import type {PoolClient} from 'pg';
import {processInAppNotificationBatch,type InAppPipelineResult} from './in-app-pipeline.js';

type QueryOnly=Pick<PoolClient,'query'>;

/** A single bounded transaction, invoked by a separately scheduled worker.
 * Never retry an unknown COMMIT; a later independent run reconciles using
 * persisted unique delivery rows and SKIP LOCKED. External channels remain PENDING.
 */
export async function runOneInAppNotificationBatch(
 client:QueryOnly,limit=25,
):Promise<InAppPipelineResult>{
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)
  throw new RangeError('invalid_in_app_worker_limit');
 let begun=false,commitAttempted=false;
 try{
  await client.query('BEGIN');begun=true;
  await client.query("SET LOCAL lock_timeout = '3s'");
  await client.query("SET LOCAL statement_timeout = '8s'");
  const result=await processInAppNotificationBatch(client,limit);
  commitAttempted=true;
  await client.query('COMMIT');
  return result;
 }catch{
  if(begun&&!commitAttempted)await client.query('ROLLBACK').catch(()=>{});
  // Never log connection strings, query values, bearer tokens or recipient IDs.
  throw new Error('In-app notification batch unavailable');
 }
}
