import {createHmac,timingSafeEqual} from 'node:crypto';
import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';

const DIGEST=/^[0-9a-f]{64}$/;
const PROOF=/^v1\.([0-9a-f]{64})\.([0-9]{10,13})\.([0-9a-f]{64})$/;
export const NETWORK_SEND_QUOTA=Object.freeze({
  perMinute:5,perHour:20,perDay:50,
});
export type NetworkQuotaResult=Readonly<{
  allowed:boolean;retryAfterSeconds:number;
  reason:'ok'|'network_minute'|'network_hourly'|'network_daily';
}>;

/**
 * The approved edge supplies a keyed, non-reversible 64-hex digest and
 * signs it with a backend-only shared secret. NEVER derive network identity
 * from X-Forwarded-For or an arbitrary incoming client header.
 *
 * Trusted ingress must strip inbound X-Services-Network-Proof, derive the
 * digest from a validated client address, then sign it. The signature is
 * short-lived and does not replace a real ingress access policy.
 */
export function verifyTrustedNetworkProof(
  value:unknown,key:Buffer,now=Date.now(),
):string|null{
  if(typeof value!=='string'||value.length>160||key.length!==32||
    !Number.isSafeInteger(now))return null;
  const match=PROOF.exec(value);
  if(!match)return null;
  const timestamp=Number(match[2]);
  if(!Number.isSafeInteger(timestamp)||Math.abs(now-timestamp)>30000)return null;
  const mac=createHmac('sha256',key)
    .update('services-otp-network:v1\n')
    .update(match[1]).update('\n').update(match[2]).digest();
  const actual=Buffer.from(match[3],'hex');
  return actual.length===mac.length&&timingSafeEqual(actual,mac)
    ?match[1]:null;
}

type CountRow={minute_count:string;hour_count:string;day_count:string};

/**
 * Caller holds one PG transaction for global -> network -> contact quota
 * checks AND network ledger / challenge inserts. This guard alone is not
 * enough when the signed network identity is absent: fail closed upstream.
 */
export async function checkNetworkSendQuota(
  client:Pick<PoolClient,'query'>,
  digest:string,
  now=new Date(),
):Promise<NetworkQuotaResult>{
  if(!DIGEST.test(digest)||!Number.isFinite(now.getTime()))
    throw new Error('invalid_network_quota_input');
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    ['guest-otp-network-v1',digest],
  );
  const result=await client.query<CountRow>(`
    SELECT
      count(*) FILTER (WHERE created_at > $2::timestamptz -
        interval '1 minute')::text AS minute_count,
      count(*) FILTER (WHERE created_at > $2::timestamptz -
        interval '1 hour')::text AS hour_count,
      count(*)::text AS day_count
    FROM guest_otp_network_issuances
    WHERE network_digest=$1
      AND purpose IN ('CREATE_REQUEST','MANAGE_SCHEDULE')
      AND created_at > $2::timestamptz - interval '24 hours'
  `,[digest,now]);
  const row=result.rows[0];
  if(!row)throw new Error('network_quota_query_failed');
  const minute=Number(row.minute_count),hour=Number(row.hour_count),
    day=Number(row.day_count);
  if(![minute,hour,day].every(Number.isSafeInteger)||
    minute<0||hour<0||day<0||minute>hour||hour>day)
    throw new Error('invalid_network_quota_counts');
  if(day>=NETWORK_SEND_QUOTA.perDay)
    return {allowed:false,retryAfterSeconds:86400,reason:'network_daily'};
  if(hour>=NETWORK_SEND_QUOTA.perHour)
    return {allowed:false,retryAfterSeconds:3600,reason:'network_hourly'};
  if(minute>=NETWORK_SEND_QUOTA.perMinute)
    return {allowed:false,retryAfterSeconds:60,reason:'network_minute'};
  return {allowed:true,retryAfterSeconds:0,reason:'ok'};
}

/** Must be inserted together with the OTP challenge in the SAME transaction. */
export async function recordNetworkSend(
  client:Pick<PoolClient,'query'>,digest:string,
  purpose:'CREATE_REQUEST'|'MANAGE_SCHEDULE'='CREATE_REQUEST',
):Promise<void>{
  if(!DIGEST.test(digest))throw new Error('invalid_network_digest');
  await client.query(`
    INSERT INTO guest_otp_network_issuances(id,network_digest,purpose)
    VALUES($1::uuid,$2,$3)
  `,[randomUUID(),digest,purpose]);
}
