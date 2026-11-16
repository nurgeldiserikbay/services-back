import type {PoolClient} from 'pg';
import {hashAdminSessionToken} from '../admin/admin-session-token.js';
import {resolvePlatformAdminSession} from '../admin/admin-session-resolver.js';
import {canPerformAdminOperation} from '../admin/admin-authorization.policy.js';
import type {ExternalProvider} from './external-provider-reconciliation.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE=/^organization:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
type Database=Readonly<{
 query:PoolClient['query'];
 transaction:<T>(run:(client:PoolClient)=>Promise<T>)=>Promise<T>;
}>;
type Target=Readonly<{intent_id:string;channel:'EMAIL'|'SMS'}>;

/**
 * Internal only: never bind this function directly to an HTTP endpoint.
 * The caller must authenticate the admin bearer from a trusted transport,
 * enforce CSRF, and use a database implementation whose transaction commits
 * all changes (including the audit row) or rolls all of them back.
 *
 * Only organization-scoped, terminal FAILED external messages can be reset.
 * The provider must conclusively return NOT_FOUND for the STABLE intent key
 * BEFORE the transaction, ruling out a known accepted send. UNKNOWN fails closed.
 * The same stable provider key is retained for later workers.
 */
export async function requeueFailedOrganizationDelivery(
 db:Database,
 provider:Pick<ExternalProvider,'supportsIdempotentSend'|'reconcile'>,
 bearer:unknown,
 sessionPepper:Buffer,
 deliveryId:string,
 requeueKey:string,
 resourceScope:string,
 now=Date.now(),
):Promise<'REQUEUED'|'ALREADY_REQUEUED'|'DENIED'|'UNCERTAIN'>{
 if(!db||typeof db.query!=='function'||typeof db.transaction!=='function'||
    !provider||provider.supportsIdempotentSend!==true||
    typeof provider.reconcile!=='function')
  throw new Error('external_provider_idempotency_required');
 if(!UUID.test(deliveryId)||!UUID.test(requeueKey)||
    !SCOPE.test(resourceScope)||!Number.isSafeInteger(now)||now<0||
    !Buffer.isBuffer(sessionPepper)||sessionPepper.length!==32)
  return 'DENIED';

 // Authorize BEFORE contacting an external provider; authorization is checked
 // again within the commit transaction against current session and grants.
 const principal=await resolvePlatformAdminSession(db,bearer,sessionPepper,now);
 if(!canPerformAdminOperation(principal,'notifications.requeue',resourceScope,now))
  return 'DENIED';
 const organizationId=resourceScope.slice('organization:'.length);
 const target=await db.query<Target>(`
  SELECT n.id::text AS intent_id,d.channel
  FROM notification_deliveries d
  JOIN notification_intents n ON n.id=d.intent_id AND n.channel=d.channel
  WHERE d.id=$1::uuid AND n.recipient_org_id=$2::uuid
    AND d.channel IN ('EMAIL','SMS') AND d.state='FAILED' AND n.state='FAILED'
    AND d.attempt_count=n.attempts AND d.attempt_count>=1
    AND d.lease_token IS NULL AND d.lease_expires_at IS NULL
    AND d.next_attempt_at IS NULL AND n.next_attempt_at IS NULL
 `,[deliveryId,organizationId]);
 if(target.rows.length!==1)return 'DENIED';
 const item=target.rows[0];
 if(!UUID.test(item.intent_id)||(item.channel!=='EMAIL'&&item.channel!=='SMS'))
  throw new Error('invalid_dead_letter_target');

 // A provider that cannot reliably reconcile idempotency keys cannot replay.
 let status:'ACCEPTED'|'NOT_FOUND'|'UNKNOWN';
 try{
  const value=await provider.reconcile(item.channel+':'+item.intent_id,item.channel);
  status=value==='ACCEPTED'||value==='NOT_FOUND'?value:'UNKNOWN';
 }catch{
  return 'UNCERTAIN';
 }
 if(status!=='NOT_FOUND')return 'UNCERTAIN';

 return db.transaction(async(client)=>{
  const current=await resolvePlatformAdminSession(client,bearer,sessionPepper,Date.now());
  if(!canPerformAdminOperation(current,'notifications.requeue',resourceScope,Date.now()))
   return 'DENIED';
  // Take a share lock on the session/staff/grant to serialize revocation and
  // role/scope mutations with this critical write. The security policy itself
  // is checked above via a fresh server-side principal.
  const hash=hashAdminSessionToken(bearer as string,sessionPepper);
  const actor=await client.query<{staff_id:string}>(`
   SELECT staff.id::text AS staff_id
   FROM platform_admin_sessions session
   JOIN platform_admin_staff staff ON staff.id=session.staff_id
   JOIN users usr ON usr.id=staff.user_id
   JOIN platform_admin_grants grants ON grants.staff_id=staff.id
   JOIN platform_admin_totp_factors factor ON factor.staff_id=staff.id
   WHERE session.token_hash=$1 AND usr.id=$2::uuid
     AND staff.role IN ('owner','admin')
     AND staff.disabled_at IS NULL AND usr.status='ACTIVE'
     AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp()
     AND factor.activated_at IS NOT NULL
     AND factor.activated_at<=session.mfa_verified_at
     AND factor.disabled_at IS NULL
     AND grants.scope=$3
   FOR SHARE OF session,staff,usr,grants,factor
  `,[hash,current!.userId,resourceScope]);
  if(actor.rows.length!==1||!UUID.test(actor.rows[0].staff_id))
   return 'DENIED';

  const existing=await client.query<{delivery_id:string}>(`
   SELECT delivery_id::text FROM notification_requeue_audit
   WHERE requeue_key=$1::uuid
  `,[requeueKey]);
  if(existing.rows.length>0)return 'ALREADY_REQUEUED';

  const selected=await client.query<{
   intent_id:string;channel:string;attempt_count:number;intent_attempts:number;
  }>(`
   SELECT n.id::text AS intent_id,d.channel,d.attempt_count,
          n.attempts AS intent_attempts
   FROM notification_deliveries d
   JOIN notification_intents n ON n.id=d.intent_id AND n.channel=d.channel
   WHERE d.id=$1::uuid AND n.recipient_org_id=$2::uuid
     AND d.channel IN ('EMAIL','SMS')
     AND d.state='FAILED' AND n.state='FAILED'
     AND d.lease_token IS NULL AND d.lease_expires_at IS NULL
     AND d.next_attempt_at IS NULL AND n.next_attempt_at IS NULL
   FOR UPDATE OF d,n
  `,[deliveryId,organizationId]);
  if(selected.rows.length!==1)return 'DENIED';
  const row=selected.rows[0];
  if(row.intent_id!==item.intent_id||row.channel!==item.channel||
     !Number.isSafeInteger(row.attempt_count)||row.attempt_count<1||
     row.intent_attempts!==row.attempt_count)
   throw new Error('notification_dead_letter_inconsistent');
  const updated=await client.query<{id:string}>(`
   UPDATE notification_deliveries
   SET state='PENDING',attempt_count=0,next_attempt_at=NULL
   WHERE id=$1::uuid AND state='FAILED'
   RETURNING id::text
  `,[deliveryId]);
  if(updated.rows.length!==1)throw new Error('notification_dead_letter_conflict');
  const intent=await client.query<{id:string}>(`
   UPDATE notification_intents
   SET state='PENDING',attempts=0,next_attempt_at=NULL
   WHERE id=$1::uuid AND state='FAILED'
   RETURNING id::text
  `,[row.intent_id]);
  if(intent.rows.length!==1)throw new Error('notification_dead_letter_conflict');
  const audit=await client.query<{id:string}>(`
   INSERT INTO notification_requeue_audit
     (delivery_id,intent_id,actor_staff_id,requeue_key)
   VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)
   RETURNING id::text
  `,[deliveryId,row.intent_id,actor.rows[0].staff_id,requeueKey]);
  if(audit.rows.length!==1||!UUID.test(audit.rows[0].id))
   throw new Error('notification_dead_letter_audit_unavailable');
  return 'REQUEUED';
 });
}
