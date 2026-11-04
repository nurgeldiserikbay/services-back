import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {classifyRequestCancellation} from './request-cancellation-policy.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A server-side authorization decision, NEVER reconstructed from HTTP JSON. */
export type AuthorizedCancellationPrincipal=
  | Readonly<{side:'customer';kind:'person';personId:string}>
  | Readonly<{side:'customer';kind:'guest';guestContactId:string}>
  | Readonly<{side:'provider';kind:'professional';sellerId:string}>
  | Readonly<{side:'provider';kind:'organization';sellerId:string}>;

export class PendingCancellationRejected extends Error{
  constructor(readonly reason:'not_found'|'forbidden'|'conflict'|'undeliverable'){
    super(reason);
  }
}

export type PendingCancellationResult=Readonly<{
  id:string;state:'cancelled_by_customer'|'cancelled_by_provider';
  version:number;cancellationId:string;
}>;

type Row={
  id:string;status:string;version:number;
  customer_person_id:string|null;guest_contact_id:string|null;
  seller_professional_id:string|null;seller_organization_id:string|null;
  customer_penalty_suspended:boolean;
  schedule_reconciliation_required:boolean;
};
type Recipient={personId?:string;organizationId?:string;guestContactId?:string;channel:'IN_APP'|'SMS'|'EMAIL'};

/**
 * Purely transactional write unit. The caller must authenticate and authorize
 * a person, guest capability, or seller organization member FIRST, and wrap
 * this operation in a single DatabasePool.transaction() call. It is not a
 * remotely callable or independently authenticated service.
 *
 * Only PENDING is supported. Accepted cancellation needs the persisted
 * snapshot, reliability formula decisions and separate audited implementation.
 */
export async function cancelAuthorizedPendingRequest(
  client:Pick<PoolClient,'query'>,
  requestId:string,
  principal:AuthorizedCancellationPrincipal,
  expectedVersion:number,
):Promise<PendingCancellationResult>{
  if(!UUID.test(requestId)||!Number.isSafeInteger(expectedVersion)||
     expectedVersion<1||!principal||
     (principal.side!=='customer'&&principal.side!=='provider'))
    throw new PendingCancellationRejected('not_found');
  const identity=principal.kind==='person'?principal.personId:
    principal.kind==='guest'?principal.guestContactId:principal.sellerId;
  if(!UUID.test(identity))throw new PendingCancellationRejected('not_found');

  // Lock before checking state and authority to serialize concurrent actions.
  const selected=await client.query<Row>(`
    SELECT id::text,status::text,version,customer_person_id::text,
      guest_contact_id::text,seller_professional_id::text,
      seller_organization_id::text,customer_penalty_suspended,
      schedule_reconciliation_required
    FROM service_requests WHERE id=$1::uuid FOR UPDATE
  `,[requestId]);
  const row=selected.rows[0];
  if(!row)throw new PendingCancellationRejected('not_found');

  const authorized=principal.side==='customer'
    ? (principal.kind==='person'
        ? row.customer_person_id===identity&&row.guest_contact_id===null
        : principal.kind==='guest'&&row.guest_contact_id===identity&&row.customer_person_id===null)
    : (principal.kind==='professional'
        ? row.seller_professional_id===identity&&row.seller_organization_id===null
        : principal.kind==='organization'&&row.seller_organization_id===identity&&row.seller_professional_id===null);
  if(!authorized)throw new PendingCancellationRejected('forbidden');
  if(row.status!=='PENDING'||row.version!==expectedVersion)
    throw new PendingCancellationRejected('conflict');

  const clock=await client.query<{now:Date}>('SELECT now() AS now');
  const now=clock.rows[0]?.now;
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
    throw new PendingCancellationRejected('conflict');
  const result=classifyRequestCancellation({
    state:'PENDING',actor:principal.side,now,
    customerPersonId:row.customer_person_id,
    sellerProfessionalId:row.seller_professional_id,
    sellerOrganizationId:row.seller_organization_id,
    snapshot:null,
    customerPenaltySuspended:row.customer_penalty_suspended,
    scheduleReconciliationRequired:row.schedule_reconciliation_required,
  });
  if(result.isLate||result.reliability)
    throw new PendingCancellationRejected('conflict');

  // Validate BOTH recipients before any mutation. Failure must abort the
  // transaction, never silently discard a customer or seller notification.
  let customer:Recipient;
  if(row.customer_person_id){
    customer={personId:row.customer_person_id,channel:'IN_APP'};
  }else if(row.guest_contact_id){
    const guest=await client.query<{channel:string}>(`
      SELECT channel FROM guest_contacts
      WHERE id=$1::uuid AND verified_at IS NOT NULL AND expires_at>now()
    `,[row.guest_contact_id]);
    const channel=guest.rows[0]?.channel?.toLowerCase();
    if(channel!=='email'&&channel!=='sms')
      throw new PendingCancellationRejected('undeliverable');
    customer={guestContactId:row.guest_contact_id,
      channel:channel.toUpperCase() as 'SMS'|'EMAIL'};
  }else throw new PendingCancellationRejected('undeliverable');

  let seller:Recipient;
  if(row.seller_professional_id){
    const profile=await client.query<{person_id:string}>(`
      SELECT person_id::text FROM professional_profiles WHERE id=$1::uuid
    `,[row.seller_professional_id]);
    if(!profile.rows[0]?.person_id)
      throw new PendingCancellationRejected('undeliverable');
    seller={personId:profile.rows[0].person_id,channel:'IN_APP'};
  }else if(row.seller_organization_id){
    seller={organizationId:row.seller_organization_id,channel:'IN_APP'};
  }else throw new PendingCancellationRejected('undeliverable');

  const transitioned=await client.query<{version:number}>(`
    UPDATE service_requests
    SET status=$2::"RequestStatus",version=version+1
    WHERE id=$1::uuid AND status='PENDING' AND version=$3
    RETURNING version
  `,[requestId,result.nextState,expectedVersion]);
  if(!transitioned.rows[0])
    throw new PendingCancellationRejected('conflict');

  const cancellationId=randomUUID(),domainEventId=randomUUID();
  await client.query(`
    INSERT INTO cancellation_events(id,request_id,actor,is_late,at)
    VALUES($1::uuid,$2::uuid,$3::"CancellationActor",false,$4)
  `,[cancellationId,requestId,result.actor,now]);
  await client.query(`
    INSERT INTO service_request_events(id,request_id,kind,detail,at)
    VALUES($1::uuid,$2::uuid,$3,'{}'::jsonb,$4)
  `,[randomUUID(),requestId,result.nextState,now]);
  await client.query(`
    INSERT INTO domain_outbox_events(id,topic,subject_kind,subject_id,safe_payload)
    VALUES($1::uuid,'service_request.cancelled','ServiceRequest',$2::uuid,'{}'::jsonb)
  `,[domainEventId,requestId]);

  const targets=result.actor==='CUSTOMER'
    ? [{audience:'INITIATOR',recipient:customer},
       {audience:'COUNTERPARTY',recipient:seller}]
    : [{audience:'INITIATOR',recipient:seller},
       {audience:'COUNTERPARTY',recipient:customer}];
  for(const {audience,recipient} of targets){
    await client.query(`
      INSERT INTO notification_intents
        (id,cancellation_id,domain_event_id,recipient_person_id,
         recipient_org_id,guest_contact_id,audience,channel,dedupe_key)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9)
    `,[
      randomUUID(),cancellationId,domainEventId,
      recipient.personId??null,recipient.organizationId??null,
      recipient.guestContactId??null,audience,recipient.channel,
      'cancel:'+requestId+':'+audience.toLowerCase(),
    ]);
  }
  return {id:requestId,state:result.nextState.toLowerCase() as PendingCancellationResult['state'],
    version:transitioned.rows[0].version,cancellationId};
}
