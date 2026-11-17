import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';

type SqlClient=Pick<PoolClient,'query'>;

/**
 * Prevent overlapping operator-invoked staging sends for the same receiver
 * scope, even across separate CLI processes sharing the same PostgreSQL.
 *
 * The session-scoped advisory lock must remain on the SAME connection while
 * the HTTPS operation is awaited. No cron or automatic retries are created.
 * A later manual run can still repeat an earlier delivered alert; this is
 * concurrency protection, NOT persistent deduplication or paging approval.
 */
export async function runWithReceiverMonitoringSessionLock<T>(
 db:SqlClient,
 receiverScope:string,
 operation:()=>Promise<T>,
):Promise<T>{
 if(typeof receiverScope!=='string'||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(receiverScope)||
    typeof operation!=='function')
  throw new Error('invalid_external_alert_receiver_send_lock');
 // Domain-separated, deterministic 64-bit PostgreSQL advisory key.
 const digest=createHash('sha256')
  .update('services.receiver-monitor-staging-send.v1\0')
  .update(receiverScope)
  .digest();
 const lockId=digest.readBigInt64BE(0).toString();
 const acquired=await db.query(
  'SELECT pg_try_advisory_lock($1::bigint) AS acquired',[lockId]);
 if(acquired.rows.length!==1||acquired.rows[0]?.acquired!==true)
  throw new Error('external_alert_receiver_send_already_running');
 try{
  return await operation();
 }finally{
  // Never leave a session-level lock on a pooled/reused connection.
  const released=await db.query(
   'SELECT pg_advisory_unlock($1::bigint) AS released',[lockId]);
  if(released.rows.length!==1||released.rows[0]?.released!==true)
   throw new Error('external_alert_receiver_send_unlock_failed');
 }
}
