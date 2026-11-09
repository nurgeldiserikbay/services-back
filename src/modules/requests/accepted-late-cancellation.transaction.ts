import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {classifyRequestCancellation,CancellationPolicyRejected}
  from './request-cancellation-policy.js';
import {validateReviewedReliabilityPolicy,
  type ReviewedReliabilityPolicy} from './reviewed-reliability-policy.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class LateCancellationRejected extends Error{
  constructor(readonly reason:'unavailable'|'conflict'){
    super('Late cancellation unavailable');
  }
}
type RequestRow={
  status:string;version:number;customer_person_id:string|null;
  guest_contact_id:string|null;seller_professional_id:string|null;
  seller_organization_id:string|null;scheduled_start_at:Date|null;
  scheduled_end_at:Date|null;accepted_at:Date|null;timezone:string|null;
  customer_penalty_suspended:boolean;schedule_reconciliation_required:boolean;
};
type SnapshotRow={
  scheduled_start_at:Date;free_cancel_until:Date;
  accepted_at:Date;policy_revision:number;timezone:string;
};
export type LateCancellationResult=Readonly<{
  id:string;state:'cancelled_by_customer';version:number;
  cancellationId:string;reliabilityProposed:boolean;
}>;

/**
 * Only callable within the owner's PostgreSQL transaction, after account
 * authentication and CSRF. The reviewed policy must originate from protected
 * server configuration, NEVER a browser body, URL, or caller-controlled header.
 * No controller/route is enabled by this change.
 *
 * A proposal is deliberately PROPOSED, never EFFECTIVE: appeals, review and
 * score projection belong to a separately audited workflow.
 */
export async function cancelAcceptedLateByRegisteredCustomer(
  db:Pick<PoolClient,'query'>,
  requestId:string,authorizedPersonId:string,expectedVersion:number,
  reviewedPolicy:ReviewedReliabilityPolicy,
):Promise<LateCancellationResult>{
  if(typeof requestId!=='string'||!UUID.test(requestId)||
     typeof authorizedPersonId!=='string'||!UUID.test(authorizedPersonId)||
     !Number.isSafeInteger(expectedVersion)||expectedVersion<1)
    throw new LateCancellationRejected('unavailable');
  // Fail closed BEFORE taking any request lock if the operator has not
  // provided an explicitly reviewed and bounded formula.
  const policyConfig=validateReviewedReliabilityPolicy(reviewedPolicy);
  const id=requestId.toLowerCase();
  const selected=await db.query<RequestRow>(`
    SELECT status::text,version,customer_person_id::text,
      guest_contact_id::text,seller_professional_id::text,
      seller_organization_id::text,scheduled_start_at,scheduled_end_at,
      accepted_at,timezone,customer_penalty_suspended,
      schedule_reconciliation_required
    FROM service_requests WHERE id=$1::uuid FOR UPDATE
  `,[id]);
  const row=selected.rows[0];
  if(!row||row.customer_person_id!==authorizedPersonId.toLowerCase()||
     row.guest_contact_id!==null)
    throw new LateCancellationRejected('unavailable');
  if(row.status!=='ACCEPTED'||row.version!==expectedVersion||
     row.schedule_reconciliation_required)
    throw new LateCancellationRejected('conflict');
  // Do not classify a preferred time or unconfirmed acceptance as late.
  if(!(row.scheduled_start_at instanceof Date)||
     !(row.scheduled_end_at instanceof Date)||
     !(row.accepted_at instanceof Date)||!row.timezone||
     row.scheduled_end_at.getTime()<=row.scheduled_start_at.getTime())
    throw new LateCancellationRejected('conflict');
  const snapshots=await db.query<SnapshotRow>(`
    SELECT scheduled_start_at,free_cancel_until,accepted_at,
      policy_revision,timezone
    FROM cancellation_snapshots
    WHERE request_id=$1::uuid FOR UPDATE
  `,[id]);
  const snap=snapshots.rows[0];
  if(!snap||snap.scheduled_start_at.getTime()!==row.scheduled_start_at.getTime()||
    snap.accepted_at.getTime()!==row.accepted_at.getTime()||
    snap.timezone!==row.timezone)
    throw new LateCancellationRejected('conflict');

  // Block pending schedule changes and locked reconciliation state; the
  // immutable cutoff must correspond to this confirmed schedule.
  const proposals=await db.query<{initiator:string}>(`
    SELECT initiator::text FROM schedule_proposals
    WHERE request_id=$1::uuid AND status='PROPOSED'
  `,[id]);
  const customerMayExitSellerReschedule=
    row.customer_penalty_suspended&&proposals.rows.length===1&&
    proposals.rows[0].initiator==='SELLER';
  if(proposals.rows.length>0&&!customerMayExitSellerReschedule)
    throw new LateCancellationRejected('conflict');
  const nowResult=await db.query<{now:Date}>('SELECT clock_timestamp() AS now');
  const now=nowResult.rows[0]?.now;
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
    throw new LateCancellationRejected('conflict');
  let classification;
  try{
    classification=classifyRequestCancellation({
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
      throw new LateCancellationRejected('conflict');
    throw e;
  }
  // This operation handles strictly-late accepted cancellations only. If
  // suspension is active, cancellation still proceeds without a rating event.
  if(!classification.isLate||
     classification.nextState!=='CANCELLED_BY_CUSTOMER'||
     classification.requiredAudiences.length!==2)
    throw new LateCancellationRejected('conflict');

  let sellerPersonId:string|null=null,sellerOrgId:string|null=null;
  if(row.seller_professional_id){
    const seller=await db.query<{person_id:string}>(`
      SELECT person_id::text FROM professional_profiles WHERE id=$1::uuid
    `,[row.seller_professional_id]);
    sellerPersonId=seller.rows[0]?.person_id??null;
    if(!sellerPersonId)throw new LateCancellationRejected('conflict');
  }else if(row.seller_organization_id){
    sellerOrgId=row.seller_organization_id;
  }else throw new LateCancellationRejected('conflict');

  const updated=await db.query<{version:number}>(`
    UPDATE service_requests
    SET status='CANCELLED_BY_CUSTOMER',version=version+1
    WHERE id=$1::uuid AND status='ACCEPTED' AND version=$2
    RETURNING version
  `,[id,expectedVersion]);
  if(!updated.rows[0])throw new LateCancellationRejected('conflict');
  await db.query(`
    UPDATE schedule_proposals SET status='CLOSED',resolved_at=now(),resolved_by='CUSTOMER'
    WHERE request_id=$1::uuid AND status='PROPOSED'
  `,[id]);
  await db.query('DELETE FROM busy_blocks WHERE request_id=$1::uuid',[id]);
  const cancellationId=randomUUID(),eventId=randomUUID();
  await db.query(`
    INSERT INTO cancellation_events(id,request_id,actor,is_late,at)
    VALUES($1::uuid,$2::uuid,'CUSTOMER',true,$3)
  `,[cancellationId,id,now]);
  await db.query(`
    INSERT INTO service_request_events(id,request_id,kind,detail,at)
    VALUES($1::uuid,$2::uuid,'CANCELLED_BY_CUSTOMER','{}'::jsonb,$3)
  `,[randomUUID(),id,now]);
  await db.query(`
    INSERT INTO domain_outbox_events
      (id,topic,subject_kind,subject_id,safe_payload)
    VALUES($1::uuid,'service_request.cancelled','ServiceRequest',
      $2::uuid,'{}'::jsonb)
  `,[eventId,id]);
  for(const notice of [
    {audience:'INITIATOR',personId:row.customer_person_id,orgId:null},
    {audience:'COUNTERPARTY',personId:sellerPersonId,orgId:sellerOrgId},
  ]){
    await db.query(`
      INSERT INTO notification_intents
        (id,cancellation_id,domain_event_id,recipient_person_id,
         recipient_org_id,audience,channel,dedupe_key)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,'IN_APP',$7)
    `,[randomUUID(),cancellationId,eventId,
      notice.personId,notice.orgId,notice.audience,
      'cancel:'+id+':'+notice.audience.toLowerCase()]);
  }

  let reliabilityProposed=false;
  if(classification.reliability){
    if(classification.reliability.subject!=='CUSTOMER'||
       classification.reliability.targetId!==row.customer_person_id)
      throw new LateCancellationRejected('conflict');
    await db.query(`
      INSERT INTO reliability_events
        (id,request_id,subject,customer_person_id,reason,weight,status,
         formula_version,dedupe_key)
      VALUES($1::uuid,$2::uuid,'CUSTOMER',$3::uuid,
        'LATE_CUSTOMER_CANCELLATION',$4::numeric,'PROPOSED',$5,$6)
    `,[
      randomUUID(),id,row.customer_person_id,
      policyConfig.lateCustomerWeight,policyConfig.formulaVersion,
      'late-customer-cancellation:'+id,
    ]);
    reliabilityProposed=true;
  }
  return {id,state:'cancelled_by_customer',version:updated.rows[0].version,
    cancellationId,reliabilityProposed};
}
