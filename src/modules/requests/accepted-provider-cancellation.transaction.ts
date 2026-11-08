import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {assertAuthorizedProviderCancellation} from './provider-cancellation-authorization.js';
import {classifyRequestCancellation} from './request-cancellation-policy.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Query=Pick<PoolClient,'query'>;
export class AcceptedProviderCancellationRejected extends Error{
  constructor(readonly reason:'unavailable'|'conflict'|'policy_unavailable'){
    super('Accepted provider cancellation unavailable');
  }
}
export type ReviewedProviderReliability=Readonly<{
  formulaVersion:string;approvalId:string;providerWeight:string;
}>;
/** Explicit trusted server-side reviewed weight; no defaults, no browser input. */
export function validateReviewedProviderReliability(value:unknown):ReviewedProviderReliability{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new AcceptedProviderCancellationRejected('policy_unavailable');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==3||
     typeof v.formulaVersion!=='string'||
     !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(v.formulaVersion)||
     typeof v.approvalId!=='string'||
     !/^[A-Z0-9][A-Z0-9_-]{5,63}$/.test(v.approvalId)||
     typeof v.providerWeight!=='string'||
     !/^(?:0\.[0-9]{1,2}|[1-9][0-9]?(?:\.[0-9]{1,2})?)$/.test(v.providerWeight)||
     Number(v.providerWeight)<=0)
    throw new AcceptedProviderCancellationRejected('policy_unavailable');
  return {formulaVersion:v.formulaVersion,approvalId:v.approvalId,
    providerWeight:v.providerWeight};
}
type RequestRow={
  status:string;version:number;customer_person_id:string|null;
  guest_contact_id:string|null;seller_professional_id:string|null;
  seller_organization_id:string|null;scheduled_start_at:Date|null;
  scheduled_end_at:Date|null;accepted_at:Date|null;timezone:string|null;
  customer_penalty_suspended:boolean;schedule_reconciliation_required:boolean;
};
type Snapshot={
  scheduled_start_at:Date;accepted_at:Date;free_cancel_until:Date;
  policy_revision:number;timezone:string;
};
export type AcceptedProviderCancellationResult=Readonly<{
  id:string;state:'cancelled_by_provider';version:number;
  cancellationId:string;reliabilityProposed:true;
}>;
/**
 * Caller-owned PostgreSQL transaction participant; NOT an HTTP handler.
 * Caller must authenticate the person, enforce CSRF and durable idempotency,
 * and BEGIN/COMMIT/ROLLBACK this entire operation. The caller supplies only
 * the trusted session person ID and a reviewed, server-held policy.
 *
 * Intentional first slice: ACTIVE account + original professional owner or
 * ACTIVE organization owner, registered customer, confirmed schedule only.
 * No delegated employee, guest or company operator access here.
 * Each competing schedule mutation must lock the service_requests row.
 */
export async function cancelAcceptedByVerifiedProviderOwner(
  db:Query,requestId:string,authenticatedPersonId:string,
  expectedVersion:number,reviewedPolicy:ReviewedProviderReliability,
):Promise<AcceptedProviderCancellationResult>{
  if(typeof requestId!=='string'||!UUID.test(requestId)||
     typeof authenticatedPersonId!=='string'||!UUID.test(authenticatedPersonId)||
     !Number.isSafeInteger(expectedVersion)||expectedVersion<1)
    throw new AcceptedProviderCancellationRejected('unavailable');
  const cfg=validateReviewedProviderReliability(reviewedPolicy);
  const id=requestId.toLowerCase(),person=authenticatedPersonId.toLowerCase();
  const selected=await db.query<RequestRow>(`
    SELECT status::text,version,customer_person_id::text,
      guest_contact_id::text,seller_professional_id::text,
      seller_organization_id::text,scheduled_start_at,scheduled_end_at,
      accepted_at,timezone,customer_penalty_suspended,
      schedule_reconciliation_required
    FROM service_requests WHERE id=$1::uuid FOR UPDATE
  `,[id]);
  const row=selected.rows[0];
  if(!row)throw new AcceptedProviderCancellationRejected('unavailable');
  if(row.status!=='ACCEPTED'||row.version!==expectedVersion||
     row.schedule_reconciliation_required)
    throw new AcceptedProviderCancellationRejected('conflict');
  if(!row.customer_person_id||row.guest_contact_id||
     !(row.scheduled_start_at instanceof Date)||
     !(row.scheduled_end_at instanceof Date)||
     !(row.accepted_at instanceof Date)||
     row.scheduled_end_at.getTime()<=row.scheduled_start_at.getTime()||
     !row.timezone)
    throw new AcceptedProviderCancellationRejected('conflict');

  const active=await db.query<{person_id:string}>(`
    SELECT p.id::text AS person_id FROM persons p JOIN users u
      ON u.id=p.user_id
    WHERE p.id=$1::uuid AND u.status='ACTIVE' FOR SHARE OF p,u
  `,[person]);
  if(active.rows[0]?.person_id?.toLowerCase()!==person)
    throw new AcceptedProviderCancellationRejected('unavailable');

  let sellerPersonId:string|null=null;
  if(row.seller_professional_id&&!row.seller_organization_id){
    const result=await db.query<{id:string;person_id:string}>(`
      SELECT id::text,person_id::text FROM professional_profiles
      WHERE id=$1::uuid AND person_id=$2::uuid FOR SHARE
    `,[row.seller_professional_id,person]);
    if(!result.rows[0])
      throw new AcceptedProviderCancellationRejected('unavailable');
    sellerPersonId=result.rows[0].person_id;
    assertAuthorizedProviderCancellation({
      personId:person,professionalProfileId:row.seller_professional_id,
      organizationMembership:null,
    },{professionalId:row.seller_professional_id,organizationId:null});
  }else if(row.seller_organization_id&&!row.seller_professional_id){
    const result=await db.query<{id:string}>(`
      SELECT id::text FROM organizations
      WHERE id=$1::uuid AND owner_person_id=$2::uuid AND status='ACTIVE'
      FOR SHARE
    `,[row.seller_organization_id,person]);
    if(!result.rows[0])
      throw new AcceptedProviderCancellationRejected('unavailable');
    assertAuthorizedProviderCancellation({
      personId:person,professionalProfileId:null,
      organizationMembership:{organizationId:row.seller_organization_id,
        role:'OWNER',status:'ACTIVE',canManageRequests:true},
    },{professionalId:null,organizationId:row.seller_organization_id});
  }else throw new AcceptedProviderCancellationRejected('conflict');

  const snapshots=await db.query<Snapshot>(`
    SELECT scheduled_start_at,accepted_at,free_cancel_until,policy_revision,timezone
    FROM cancellation_snapshots WHERE request_id=$1::uuid FOR UPDATE
  `,[id]);
  const snap=snapshots.rows[0];
  if(!snap||!(snap.scheduled_start_at instanceof Date)||
     !(snap.accepted_at instanceof Date)||
     !(snap.free_cancel_until instanceof Date)||
     snap.scheduled_start_at.getTime()!==row.scheduled_start_at.getTime()||
     snap.accepted_at.getTime()!==row.accepted_at.getTime()||
     snap.timezone!==row.timezone)
    throw new AcceptedProviderCancellationRejected('conflict');
  const proposals=await db.query<{count:string}>(`
    SELECT count(*)::text AS count FROM schedule_proposals
    WHERE request_id=$1::uuid AND status='PROPOSED'
  `,[id]);
  if(Number(proposals.rows[0]?.count??0)!==0)
    throw new AcceptedProviderCancellationRejected('conflict');
  const clock=await db.query<{now:Date}>('SELECT clock_timestamp() AS now');
  const now=clock.rows[0]?.now;
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
    throw new AcceptedProviderCancellationRejected('conflict');
  const policy=classifyRequestCancellation({
    state:'ACCEPTED',actor:'provider',now,
    customerPersonId:row.customer_person_id,
    sellerProfessionalId:row.seller_professional_id,
    sellerOrganizationId:row.seller_organization_id,
    customerPenaltySuspended:row.customer_penalty_suspended,
    scheduleReconciliationRequired:row.schedule_reconciliation_required,
    snapshot:{scheduledStartAt:snap.scheduled_start_at,
      freeCancelUntil:snap.free_cancel_until,acceptedAt:snap.accepted_at,
      policyRevision:snap.policy_revision,timezone:snap.timezone},
  });
  if(policy.nextState!=='CANCELLED_BY_PROVIDER'||policy.actor!=='SELLER'||
     !policy.reliability||policy.requiredAudiences.length!==2||
     !['PROFESSIONAL','ORGANIZATION'].includes(policy.reliability.subject))
    throw new AcceptedProviderCancellationRejected('conflict');

  // Release only this request's blocks. Audited cancellation + both recipient
  // intents + reliability proposal are atomically committed by the caller.
  const updated=await db.query<{version:number}>(`
    UPDATE service_requests SET status='CANCELLED_BY_PROVIDER',version=version+1
    WHERE id=$1::uuid AND status='ACCEPTED' AND version=$2
    RETURNING version
  `,[id,expectedVersion]);
  if(!updated.rows[0])throw new AcceptedProviderCancellationRejected('conflict');
  await db.query(`
    UPDATE schedule_proposals SET status='CLOSED',resolved_at=now(),resolved_by='SELLER'
    WHERE request_id=$1::uuid AND status='PROPOSED'
  `,[id]);
  await db.query('DELETE FROM busy_blocks WHERE request_id=$1::uuid',[id]);
  const cancellationId=randomUUID(),eventId=randomUUID();
  await db.query(`
    INSERT INTO cancellation_events(id,request_id,actor,is_late,at)
    VALUES($1::uuid,$2::uuid,'SELLER',false,$3)
  `,[cancellationId,id,now]);
  await db.query(`
    INSERT INTO service_request_events(id,request_id,kind,detail,at)
    VALUES($1::uuid,$2::uuid,'CANCELLED_BY_PROVIDER','{}'::jsonb,$3)
  `,[randomUUID(),id,now]);
  await db.query(`
    INSERT INTO domain_outbox_events(id,topic,subject_kind,subject_id,safe_payload)
    VALUES($1::uuid,'service_request.cancelled','ServiceRequest',$2::uuid,'{}'::jsonb)
  `,[eventId,id]);
  for(const target of [
    {audience:'INITIATOR',personId:sellerPersonId,
      orgId:row.seller_organization_id},
    {audience:'COUNTERPARTY',personId:row.customer_person_id,orgId:null},
  ]){
    await db.query(`
      INSERT INTO notification_intents(id,cancellation_id,domain_event_id,
        recipient_person_id,recipient_org_id,audience,channel,dedupe_key)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,'IN_APP',$7)
    `,[randomUUID(),cancellationId,eventId,target.personId,target.orgId,
      target.audience,'cancel:'+id+':'+target.audience.toLowerCase()]);
  }
  if((policy.reliability.subject==='PROFESSIONAL'&&
      policy.reliability.targetId!==row.seller_professional_id)||
     (policy.reliability.subject==='ORGANIZATION'&&
      policy.reliability.targetId!==row.seller_organization_id))
    throw new AcceptedProviderCancellationRejected('conflict');
  await db.query(`
    INSERT INTO reliability_events(id,request_id,subject,professional_id,
      organization_id,reason,weight,status,formula_version,dedupe_key)
    VALUES($1::uuid,$2::uuid,$3::"ReliabilitySubject",$4::uuid,$5::uuid,
      'PROVIDER_CANCELLATION',$6::numeric,'PROPOSED',$7,$8)
  `,[randomUUID(),id,policy.reliability.subject,
    row.seller_professional_id,row.seller_organization_id,
    cfg.providerWeight,cfg.formulaVersion,'provider-cancellation:'+id]);
  return {id,state:'cancelled_by_provider',version:updated.rows[0].version,
    cancellationId,reliabilityProposed:true};
}
