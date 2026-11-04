import type {PoolClient} from 'pg';

export const NETWORK_SEND_QUOTA=Object.freeze({
  perMinute:5,perHour:20,perDay:100,
});
type CountRow={minute_count:string;hour_count:string;day_count:string};
export type NetworkSendQuotaResult=Readonly<{
  allowed:boolean;reason:'ok'|'network_minute'|'network_hour'|'network_day';
  retryAfterSeconds:number;
}>;

/**
 * Run after the global lock and before the recipient lock, in the SAME
 * transaction that inserts the challenge and network event. Never use
 * request-provided IP, X-Forwarded-For or a browser-generated key.
 */
export async function checkNetworkSendQuota(
  client:Pick<PoolClient,'query'>,digest:string,now=new Date(),
):Promise<NetworkSendQuotaResult>{
  if(!/^[a-f0-9]{64}$/.test(digest))throw new Error('invalid_network_digest');
  if(!Number.isFinite(now.getTime()))throw new Error('invalid_time');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    ['guest-otp-network-v1',digest]);
  const result=await client.query<CountRow>(`
    SELECT
      COUNT(*) FILTER (WHERE created_at>$2::timestamptz-interval '1 minute')::text AS minute_count,
      COUNT(*) FILTER (WHERE created_at>$2::timestamptz-interval '1 hour')::text AS hour_count,
      COUNT(*)::text AS day_count
    FROM guest_otp_network_events
    WHERE network_digest=$1
      AND created_at>$2::timestamptz-interval '24 hours'
  `,[digest,now]);
  const row=result.rows[0];
  if(!row)throw new Error('network_quota_query_failed');
  const n=[row.minute_count,row.hour_count,row.day_count].map(Number);
  if(!n.every(Number.isSafeInteger)||n.some(v=>v<0)||n[0]>n[1]||n[1]>n[2])
    throw new Error('invalid_network_quota_counts');
  if(n[2]>=NETWORK_SEND_QUOTA.perDay)
    return {allowed:false,reason:'network_day',retryAfterSeconds:86400};
  if(n[1]>=NETWORK_SEND_QUOTA.perHour)
    return {allowed:false,reason:'network_hour',retryAfterSeconds:3600};
  if(n[0]>=NETWORK_SEND_QUOTA.perMinute)
    return {allowed:false,reason:'network_minute',retryAfterSeconds:60};
  return {allowed:true,reason:'ok',retryAfterSeconds:0};
}
