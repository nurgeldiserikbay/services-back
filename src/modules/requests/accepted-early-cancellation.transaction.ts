import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {classifyRequestCancellation,CancellationPolicyRejected}
  from './request-cancellation-policy.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EarlyCancellationRejected extends Error {
  constructor(readonly reason:'unavailable'|'conflict'){
    super('Cancellation unavailable');
  }
}
type RequestRow={
  id:string;status:string;version:number;customer_person_id:string|null;
  guest_contact_id:string|null;seller_professional_id:string|null;
  seller_organization_id:string|null;scheduled_start_at:Date|null;
  scheduled_end_at:Date|null;accepted_at:Date|null;timezone:string|null;
  customer_penalty_suspended:boolean;schedule_reconciliation_required:boolean;
};
type Snapshot={
  scheduled_start_at:Date;free_cancel_until:Date;accepted_at:Date;
  policy_revision:number;timezone:string;
};
export type EarlyCancellationResult=Readonly<{
  id:string;state:'cancelled_by_customer';version:number;cancellationId:string;
}>;

/**
 * Trusted internal PostgreSQL transaction participant: the caller must
 * authenticate the registered person, enforce CSRF/ACL and own BEGIN/COMMIT.
 * No HTTP endpoint is mounted. Guest READ_CANCEL and provider actions are
 * deliberately handled in separate audited flows.
 *
 * This branch is restricted to ACCEPTED, on-time, snapshotted requests.
 * Late cancellation and proposed reliability require reviewed weights/formula.
 */
export async function cancelAcceptedEarlyByCustomer(
  db:Pick<PoolClient,'query'>,
  requestId:string,authorizedCustomerPersonId:string,expectedVersion:number,
):Promise<EarlyCancellationResult>{
  if(!UUID.test(requestId)||!UUID.test(authorizedCustomerPersonId)||
    !Number.isSafeInteger(expectedVersion)||expectedVersion<1)
    throw new EarlyCancellationRejected('unavailable');

  const selected=await db.query<RequestRow>(`
    SELECT id::text,status::text,version,customer_person_id::text,
      guest_contact_id::text,seller_professional_id::text,
      seller_organization_id::text,scheduled_start_at,scheduled_end_at,
      accepted_at,timezone,customer_penalty_suspended,
      schedule_reconciliation_required
    FROM service_requests WHERE id=$1::uuid FOR UPDATE
  `,[requestId.toLowerCase()]);
  const row=selected.rows[0];
  if(!row||row.customer_person_id!==authorizedCustomerPersonId.toLowerCase()||
    row.guest_contact_id!==null)
    throw new EarlyCancellationRejected('unavailable');
  if(row.status!=='ACCEPTED'||row.version!==expectedVersion||
    row.schedule_reconciliation_required)
    throw new EarlyCancellationRejected('conflict');

  // Require a real confirmed schedule and matching immutable terms.
  // A seller acceptance without confirmed time must not fabricate a policy.
  if(!(row.scheduled_start_at instanceof Date)||
     !(row.scheduled_end_at instanceof Date)||
     !(row.accepted_at instanceof Date)||!row.timezone||
     row.scheduled_end_at.getTime()<=row.scheduled_start_at.getTime())
    throw new EarlyCancellationRejected('conflict');
  const snapshots=await db.query<Snapshot>(`
    SELECT scheduled_start_at,free_cancel_until,accepted_at,
      policy_revision,timezone
    FROM cancellation_snapshots WHERE request_id=$1::uuid FOR UPDATE
  `,[requestId.toLowerCase()]);
  const snap=snapshots.rows[0];
  if(!snap||
    snap.scheduled_start_at.getTime()!==row.scheduled_start_at.getTime()||
    snap.accepted_at.getTime()!==row.accepted_at.getTime()||
    snap.timezone!==row.timezone)
    throw new EarlyCancellationRejected('conflict');
  const clock=await db.query<{now:Date}>('SELECT clock_timestamp() AS now');
  const now=clock.rows[0]?.now;
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
    throw new EarlyCancellationRejected('conflict');

  let policy;
  try{
    policy=classifyRequestCancellation({
      state:'ACCEPTED',actor:'customer',now,
      customerPersonId:row.customer_person_id,
      sellerProfessionalId:row.seller_professional_id,
      sellerOrganizationId:row.seller_organization_id,
      customerPenaltySuspended:row.customer_penalty_suspended,
      scheduleReconciliationRequired:row.schedule_reconciliation_required,
      snapshot:{
        scheduledStartAt:snap.scheduled_start_at,
        freeCancelUntil:snap.free_cancel_until,
        acceptedAt:snap.accepted_at,
        policyRevision:snap.policy_revision,timezone:snap.timezone,
      },
    });
  }catch(e){
    if(e instanceof CancellationPolicyRejected)
      throw new EarlyCancellationRejected('conflict');
    throw e;
  }
  if(policy.isLate||policy.reliability!==null||
     policy.nextState!=='CANCELLED_BY_CUSTOMER'||
     policy.requiredAudiences.length!==2)
    throw new EarlyCancellationRejected('conflict');

  // Both counterparties must be resolvable before any mutation.
  let sellerPersonId:string|null=null,sellerOrgId:string|null=null;
  if(row.seller_professional_id){
    const seller=await db.query<{person_id:string}>(`
      SELECT person_id::text FROM professional_profiles WHERE id=$1::uuid
    `,[row.seller_professional_id]);
    sellerPersonId=seller.rows[0]?.person_id??null;
    if(!sellerPersonId)throw new EarlyCancellationRejected('conflict');
  }else if(row.seller_organization_id){
    sellerOrgId=row.seller_organization_id;
  }else throw new EarlyCancellationRejected('conflict');

  // A schedule currently being reconciled or with multiple conflicting
  // confirmations is not safe for automated release.
  const invalidProposal=await db.query<{n:string}>(`
    SELECT count(*)::text AS n FROM schedule_proposals
    WHERE request_id=$1::uuid AND status='PROPOSED'
  `,[requestId.toLowerCase()]);
  if(Number(invalidProposal.rows[0]?.n??0)>0)
    throw new EarlyCancellationRejected('conflict');

  const updated=await db.query<{version:number}>(`
    UPDATE service_requests
    SET status='CANCELLED_BY_CUSTOMER',version=version+1
    WHERE id=$1::uuid AND status='ACCEPTED' AND version=$2
    RETURNING version
  `,[requestId.toLowerCase(),expectedVersion]);
  if(!updated.rows[0])throw new EarlyCancellationRejected('conflict');

  // Releasing allocations and updating state happens in the SAME transaction.
  // Existing busy blocks for unrelated requests are never affected.
  await db.query('DELETE FROM busy_blocks WHERE request_id=$1::uuid',
    [requestId.toLowerCase()]);
  const cancellationId=randomUUID(),eventId=randomUUID();
  await db.query(`
    INSERT INTO cancellation_events(id,request_id,actor,is_late,at)
    VALUES($1::uuid,$2::uuid,'CUSTOMER',false,$3)
  `,[cancellationId,requestId.toLowerCase(),now]);
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
  const notices=[
    {audience:'INITIATOR',personId:row.customer_person_id,orgId:null},
    {audience:'COUNTERPARTY',personId:sellerPersonId,orgId:sellerOrgId},
  ];
  for(const n of notices){
    await db.query(`
      INSERT INTO notification_intents
        (id,cancellation_id,domain_event_id,recipient_person_id,
         recipient_org_id,audience,channel,dedupe_key)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,'IN_APP',$7)
    `,[randomUUID(),cancellationId,eventId,n.personId,n.orgId,n.audience,
      'cancel:'+requestId.toLowerCase()+':'+n.audience.toLowerCase()]);
  }
  return {id:requestId.toLowerCase(),state:'cancelled_by_customer',
    version:updated.rows[0].version,cancellationId};
}
