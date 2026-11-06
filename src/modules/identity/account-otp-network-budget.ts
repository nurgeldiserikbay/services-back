import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {verifyTrustedNetworkProof}
  from '../guest-requests/guest-network-quota.js';

const DIGEST=/^[0-9a-f]{64}$/;
export const ACCOUNT_OTP_NETWORK_BUDGET=Object.freeze({
  perMinute:5,perHour:20,perDay:50,
});
export type AccountOtpNetworkBudgetResult=Readonly<{
  allowed:boolean;retryAfterSeconds:number;
  reason:'ok'|'network_minute'|'network_hour'|'network_day';
}>;
type Row={minute_count:string;hour_count:string;day_count:string};

/**
 * Only a trusted ingress attestation may establish the network identity.
 * Never trust an arbitrary client-supplied digest or forwarding header.
 * Account and guest OTP have independent ledgers and budgets.
 */
export function verifyAccountOtpNetworkProof(
  assertedProof:unknown,attestationKey:Buffer,now=Date.now(),
):string|null{
  if(!Buffer.isBuffer(attestationKey)||attestationKey.length!==32)return null;
  return verifyTrustedNetworkProof(assertedProof,attestationKey,now);
}

/**
 * Transaction-only; caller holds global lock before this network lock and
 * contact lock after it. The issued challenge and ledger are committed together.
 */
export async function checkAccountOtpNetworkBudget(
  client:Pick<PoolClient,'query'>,digest:string,
):Promise<AccountOtpNetworkBudgetResult>{
  if(typeof digest!=='string'||!DIGEST.test(digest))
    throw new Error('invalid_account_otp_network_digest');
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',
    ['account-otp-network:v1',digest],
  );
  const result=await client.query<Row>(`
    SELECT
      count(*) FILTER (WHERE created_at>now()-interval '1 minute')::text
        AS minute_count,
      count(*) FILTER (WHERE created_at>now()-interval '1 hour')::text
        AS hour_count,
      count(*)::text AS day_count
    FROM account_otp_network_issuances
    WHERE network_digest=$1 AND created_at>now()-interval '24 hours'
  `,[digest]);
  const row=result.rows[0];
  if(!row)throw new Error('account_otp_network_unavailable');
  const minute=Number(row.minute_count),hour=Number(row.hour_count),
    day=Number(row.day_count);
  if(![minute,hour,day].every(Number.isSafeInteger)||
     minute<0||minute>hour||hour>day)
    throw new Error('account_otp_network_invalid_counts');
  if(day>=ACCOUNT_OTP_NETWORK_BUDGET.perDay)
    return {allowed:false,retryAfterSeconds:86400,reason:'network_day'};
  if(hour>=ACCOUNT_OTP_NETWORK_BUDGET.perHour)
    return {allowed:false,retryAfterSeconds:3600,reason:'network_hour'};
  if(minute>=ACCOUNT_OTP_NETWORK_BUDGET.perMinute)
    return {allowed:false,retryAfterSeconds:60,reason:'network_minute'};
  return {allowed:true,retryAfterSeconds:0,reason:'ok'};
}
export async function recordAccountOtpNetworkIssuance(
  client:Pick<PoolClient,'query'>,digest:string,
):Promise<void>{
  if(typeof digest!=='string'||!DIGEST.test(digest))
    throw new Error('invalid_account_otp_network_digest');
  await client.query(`
    INSERT INTO account_otp_network_issuances(id,network_digest)
    VALUES($1::uuid,$2)
  `,[randomUUID(),digest]);
}
