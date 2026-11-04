import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {hashGuestCapability} from '../guest-requests/guest-request.security.js';
import {classifyRequestCancellation,CancellationPolicyRejected,
  type RequestCancellationState,type CancellationPolicySnapshot}
  from './request-cancellation-policy.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY=/^[A-Za-z0-9_-]{43}$/;
export class GuestCancellationRejected extends Error {
  constructor(readonly reason:'unavailable'|'conflict'){
    super('Guest cancellation unavailable');
  }
}
type LockedRequest={
  id:string;status:RequestCancellationState;version:number;
  guest_contact_id:string|null;customer_person_id:string|null;
  seller_professional_id:string|null;seller_organization_id:string|null;
  customer_penalty_suspended:boolean;schedule_reconciliation_required:boolean;
};
type SnapshotRow={
  scheduled_start_at:Date;free_cancel_until:Date;
  accepted_at:Date;policy_revision:number;timezone:string;
};
type GuestContact={channel:string};
type SellerPerson={person_id:string};
export type GuestCancellationResult=Readonly<{
  id:string;state:'cancelled_by_customer';version:number;
}>;

/**
 * DB mutation inside caller-owned BEGIN/COMMIT/ROLLBACK.
 * Caller must pass the verified 256-bit hash pepper from configuration.
 * No public HTTP controller or generic user-supplied seller identity.
 *
 * Row lock + expected version protects against conflicting seller decisions.
 * A failure to persist either notification aborts the caller transaction.
 */
export async function cancelVerifiedGuestRequest(
  db:Pick<PoolClient,'query'>,
  requestId:string,readCancelToken:string,expectedVersion:number,pepper:Buffer,
):Promise<GuestCancellationResult>{
  if(typeof requestId!=='string'||!UUID.test(requestId)||
    typeof readCancelToken!=='string'||!CAPABILITY.test(readCancelToken)||
    !Buffer.isBuffer(pepper)||pepper.length!==32)
    throw new GuestCancellationRejected('unavailable');
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)
    throw new GuestCancellationRejected('conflict');
  const proofHash=hashGuestCapability('READ_CANCEL',readCancelToken,pepper);
  // Access check is scoped to the same verified guest contact and request.
  // Never accept customer ID, request owner or a bearer from the body.
  const access=await db.query<{id:string}>(`
    SELECT id::text FROM guest_capabilities
    WHERE request_id=$1::uuid AND token_hash=$2 AND scope='READ_CANCEL'
      AND consumed_at IS NULL AND expires_at>now()
    LIMIT 1
  `,[requestId.toLowerCase(),proofHash]);
  if(!access.rows[0])throw new GuestCancellationRejected('unavailable');
  const selected=await db.query<LockedRequest>(`
    SELECT id::text,status::text,version,
      guest_contact_id::text,customer_person_id::text,
      seller_professional_id::text,seller_organization_id::text,
      customer_penalty_suspended,schedule_reconciliation_required
    FROM service_requests WHERE id=$1::uuid FOR UPDATE
  `,[requestId.toLowerCase()]);
  const request=selected.rows[0];
  if(!request||!request.guest_contact_id||request.customer_person_id||
    Boolean(request.seller_professional_id)===Boolean(request.seller_organization_id))
    throw new GuestCancellationRejected('unavailable');
  // Recheck the proof after taking the request lock. A revoked, expired or
  // foreign contact capability must never authorize a state transition.
  const active=await db.query<{id:string}>(`
    SELECT id::text FROM guest_capabilities
    WHERE request_id=$1::uuid AND guest_contact_id=$2::uuid
      AND token_hash=$3 AND scope='READ_CANCEL'
      AND consumed_at IS NULL AND expires_at>now()
    LIMIT 1
  `,[requestId.toLowerCase(),request.guest_contact_id,proofHash]);
  if(!active.rows[0])throw new GuestCancellationRejected('unavailable');
  if(request.version!==expectedVersion)
    throw new GuestCancellationRejected('conflict');

  const guest=await db.query<GuestContact>(`
    SELECT channel::text FROM guest_contacts
    WHERE id=$1::uuid AND verified_at IS NOT NULL AND expires_at>now()
    LIMIT 1
  `,[request.guest_contact_id]);
  const guestChannel=guest.rows[0]?.channel?.toUpperCase();
  if(guestChannel!=='EMAIL'&&guestChannel!=='SMS')
    throw new GuestCancellationRejected('unavailable');

  // Resolve the *original* seller recipient, not an assigned performer.
  let sellerNotice:{recipient_person_id:string|null;recipient_org_id:string|null};
  if(request.seller_organization_id){
    sellerNotice={recipient_person_id:null,recipient_org_id:request.seller_organization_id};
  }else{
    const seller=await db.query<SellerPerson>(`
      SELECT person_id::text FROM professional_profiles
      WHERE id=$1::uuid LIMIT 1
    `,[request.seller_professional_id]);
    if(!seller.rows[0])throw new GuestCancellationRejected('unavailable');
    sellerNotice={recipient_person_id:seller.rows[0].person_id,recipient_org_id:null};
  }

  const snap=await db.query<SnapshotRow>(`
    SELECT scheduled_start_at,free_cancel_until,accepted_at,
           policy_revision,timezone
    FROM cancellation_snapshots WHERE request_id=$1::uuid
  `,[requestId.toLowerCase()]);
  const row=snap.rows[0];
  const snapshot:CancellationPolicySnapshot|null=row?{
    scheduledStartAt:row.scheduled_start_at,
    freeCancelUntil:row.free_cancel_until,
    acceptedAt:row.accepted_at,
    policyRevision:row.policy_revision,timezone:row.timezone,
  }:null;
  // Must use DB time, not an arbitrary browser timestamp.
  const clock=await db.query<{now:Date}>('SELECT clock_timestamp() AS now');
  const now=clock.rows[0]?.now;
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
    throw new GuestCancellationRejected('unavailable');
  let policy;
  try{
    policy=classifyRequestCancellation({
      state:request.status,actor:'customer',now,customerPersonId:null,
      sellerProfessionalId:request.seller_professional_id,
      sellerOrganizationId:request.seller_organization_id,
      snapshot,customerPenaltySuspended:request.customer_penalty_suspended,
      scheduleReconciliationRequired:request.schedule_reconciliation_required,
    });
  }catch(error){
    if(error instanceof CancellationPolicyRejected)
      throw new GuestCancellationRejected('conflict');
    throw error;
  }
  if(policy.nextState!=='CANCELLED_BY_CUSTOMER'||policy.reliability!==null||
    policy.requiredAudiences.length!==2)
    throw new GuestCancellationRejected('conflict');

  const updated=await db.query<{version:number}>(`
    UPDATE service_requests SET status='CANCELLED_BY_CUSTOMER',
      version=version+1
    WHERE id=$1::uuid AND version=$2 AND status=$3::"RequestStatus"
    RETURNING version
  `,[requestId.toLowerCase(),expectedVersion,request.status]);
  if(!updated.rows[0])throw new GuestCancellationRejected('conflict');

  const cancellationId=randomUUID(),eventId=randomUUID();
  await db.query(`
    INSERT INTO cancellation_events(id,request_id,actor,is_late,at)
    VALUES($1::uuid,$2::uuid,'CUSTOMER',$3,$4)
  `,[cancellationId,requestId.toLowerCase(),policy.isLate,now]);
  await db.query(`
    INSERT INTO service_request_events(id,request_id,kind,detail,at)
    VALUES($1::uuid,$2::uuid,'CANCELLED_BY_CUSTOMER','{}'::jsonb,$3)
  `,[randomUUID(),requestId.toLowerCase(),now]);
  await db.query(`
    INSERT INTO domain_outbox_events
      (id,topic,subject_kind,subject_id,safe_payload)
    VALUES($1::uuid,'service_request.cancelled','ServiceRequest',
      $2::uuid,'{}'::jsonb)
  `,[eventId,requestId.toLowerCase()]);
  // These two inserts are mandatory and are executed in the SAME transaction
  // as the cancellation state change. Delivery is handled asynchronously.
  await db.query(`
    INSERT INTO notification_intents
      (id,cancellation_id,domain_event_id,guest_contact_id,
       audience,channel,dedupe_key)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'INITIATOR',$5,$6)
  `,[randomUUID(),cancellationId,eventId,request.guest_contact_id,
    guestChannel,'cancel:init:'+requestId.toLowerCase()]);
  await db.query(`
    INSERT INTO notification_intents
      (id,cancellation_id,domain_event_id,recipient_person_id,recipient_org_id,
       audience,channel,dedupe_key)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,
      'COUNTERPARTY','IN_APP',$6)
  `,[randomUUID(),cancellationId,eventId,
    sellerNotice.recipient_person_id,sellerNotice.recipient_org_id,
    'cancel:counterparty:'+requestId.toLowerCase()]);
  return {id:requestId.toLowerCase(),state:'cancelled_by_customer',
    version:updated.rows[0].version};
}
