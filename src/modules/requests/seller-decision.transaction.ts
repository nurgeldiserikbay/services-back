import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';

export type SellerIdentity =
  | {kind:'professional';sellerId:string}
  | {kind:'organization';sellerId:string};

export type SellerDecision='accept'|'decline';
export type DecisionResult={
  id:string;state:'accepted'|'declined';version:number;replayed:boolean;
};

/**
 * This function only receives a seller identity from an authenticated,
 * resource-authorized server-side context. It does NOT itself authenticate
 * a user or validate organization membership.
 */
export class SellerDecisionRejected extends Error {
  constructor(readonly reason:'not_found'|'forbidden'|'conflict') {super(reason);}
}
// Reuse a strict UUID pattern for all public-like IDs.
const UUID_STRICT=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RequestRow={
  id:string;status:string;version:number;
  seller_professional_id:string|null;seller_organization_id:string|null;
  customer_person_id:string|null;guest_contact_id:string|null;
};
type GuestContactRow={channel:string};

export async function decideSellerRequest(
  client:Pick<PoolClient,'query'>,
  requestId:string,
  seller:SellerIdentity,
  decision:SellerDecision,
  expectedVersion:number,
):Promise<DecisionResult> {
  if(typeof requestId!=='string'||!UUID_STRICT.test(requestId)||
     !seller||typeof seller!=='object'||
     typeof seller.sellerId!=='string'||!UUID_STRICT.test(seller.sellerId) ||
     (seller.kind!=='professional'&&seller.kind!=='organization') ||
     (decision!=='accept'&&decision!=='decline') ||
     !Number.isSafeInteger(expectedVersion)||expectedVersion<1)
    throw new SellerDecisionRejected('not_found');

  // Row lock serializes accept/decline and prevents simultaneous approvals.
  const selection=await client.query<RequestRow>(`
    SELECT id::text,status,version,seller_professional_id::text,
           seller_organization_id::text,customer_person_id::text,
           guest_contact_id::text
    FROM service_requests WHERE id=$1::uuid FOR UPDATE
  `,[requestId]);
  const request=selection.rows[0];
  if(!request)throw new SellerDecisionRejected('not_found');
  const owns=(seller.kind==='professional'
    ? request.seller_professional_id===seller.sellerId && request.seller_organization_id===null
    : request.seller_organization_id===seller.sellerId && request.seller_professional_id===null);
  if(!owns)throw new SellerDecisionRejected('forbidden');
  const state=decision==='accept'?'ACCEPTED':'DECLINED';
  // Replays are authorized only by the actor-scoped idempotency ledger.
  // A fresh key must not turn an already-decided request into a success.
  if(request.status!=='PENDING'||request.version!==expectedVersion)
    throw new SellerDecisionRejected('conflict');

  // Validate notification eligibility before mutating the request. The caller
  // still owns the transaction and must roll back if any later write fails.
  let verifiedGuestChannel:'email'|'sms'|null=null;
  if(!request.customer_person_id){
    if(!request.guest_contact_id)throw new SellerDecisionRejected('conflict');
    const contact=await client.query<GuestContactRow>(`
      SELECT channel FROM guest_contacts
      WHERE id=$1::uuid AND verified_at IS NOT NULL AND expires_at>now()
      FOR SHARE
    `,[request.guest_contact_id]);
    const channel=contact.rows[0]?.channel;
    if(channel!=='email'&&channel!=='sms')
      throw new SellerDecisionRejected('conflict');
    verifiedGuestChannel=channel;
  }

  const transitioned=await client.query<{version:number}>(`
    UPDATE service_requests
    SET status=$2::"RequestStatus",version=version+1,
        accepted_at=CASE WHEN $2='ACCEPTED' THEN now() ELSE accepted_at END
    WHERE id=$1::uuid AND status='PENDING' AND version=$3
    RETURNING version
  `,[requestId,state,expectedVersion]);
  if(!transitioned.rows[0])throw new SellerDecisionRejected('conflict');

  // Acceptance does not invent a calendar reservation or confirmed time.
  // Time/policy confirmation is a separate bilateral operation.
  const topic=decision==='accept'?'service_request.accepted':'service_request.declined';
  const eventId=randomUUID();
  await client.query(`
    INSERT INTO service_request_events(id,request_id,kind,detail)
    VALUES($1::uuid,$2::uuid,$3,'{}'::jsonb)
  `,[randomUUID(),requestId,decision==='accept'?'ACCEPTED':'DECLINED']);
  await client.query(`
    INSERT INTO domain_outbox_events(id,topic,subject_kind,subject_id,safe_payload)
    VALUES($1::uuid,$2,'ServiceRequest',$3::uuid,'{}'::jsonb)
  `,[eventId,topic,requestId]);

  // Both registered customers and verified guests get a durable logical
  // notification intent. Guest providers are a future, separately gated worker.
  if(request.customer_person_id){
    await client.query(`
      INSERT INTO notification_intents
        (id,domain_event_id,recipient_person_id,audience,channel,dedupe_key)
      VALUES($1::uuid,$2::uuid,$3::uuid,'CLIENT','IN_APP',$4)
    `,[randomUUID(),eventId,request.customer_person_id,
      'request-'+decision+':client:'+requestId]);
  } else if(request.guest_contact_id) {
    await client.query(`
      INSERT INTO notification_intents
        (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key)
      VALUES($1::uuid,$2::uuid,$3::uuid,'CLIENT',$4,$5)
    `,[randomUUID(),eventId,request.guest_contact_id,verifiedGuestChannel!.toUpperCase(),
      'request-'+decision+':guest:'+requestId]);
  }else{
    throw new SellerDecisionRejected('conflict');
  }
  return {
    id:requestId,
    state:decision==='accept'?'accepted':'declined',
    version:transitioned.rows[0].version,
    replayed:false,
  };
}
