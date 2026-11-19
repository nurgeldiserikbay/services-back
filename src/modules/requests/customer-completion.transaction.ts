import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';

/**
 * Prepared transaction core. Authentication and customer ownership MUST be
 * established by the caller from a trusted server-side session; this function
 * is not an HTTP route and must run inside the caller's BEGIN/COMMIT boundary.
 *
 * Only the registered customer can confirm completion. Guest proof flows and
 * seller-initiated completion are deliberately unsupported until separately
 * specified and security-reviewed.
 */
export class CustomerCompletionRejected extends Error{
 constructor(readonly reason:'not_found'|'forbidden'|'conflict'){
  super(reason);
 }
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RequestRow={
 id:string;status:string;version:number;
 customer_person_id:string|null;
 seller_professional_id:string|null;seller_organization_id:string|null;
};
export type CustomerCompletionResult=Readonly<{
 id:string;state:'completed';version:number;
}>;

/** A confirmed completion is an immutable versioned request transition. */
export async function confirmCustomerRequestCompletion(
 client:Pick<PoolClient,'query'>,
 requestId:string,customerPersonId:string,expectedVersion:number,
):Promise<CustomerCompletionResult>{
 if(typeof requestId!=='string'||!UUID.test(requestId)||
  typeof customerPersonId!=='string'||!UUID.test(customerPersonId)||
  !Number.isSafeInteger(expectedVersion)||expectedVersion<1)
  throw new CustomerCompletionRejected('not_found');

 const id=requestId.toLowerCase(),customer=customerPersonId.toLowerCase();
 const selected=await client.query<RequestRow>(`
  SELECT id::text,status::text,version,customer_person_id::text,
   seller_professional_id::text,seller_organization_id::text
  FROM service_requests WHERE id=$1::uuid FOR UPDATE
 `,[id]);
 const row=selected.rows[0];
 if(!row)throw new CustomerCompletionRejected('not_found');
 if(row.customer_person_id!==customer)
  throw new CustomerCompletionRejected('forbidden');
 if(row.status!=='ACCEPTED'||row.version!==expectedVersion)
  throw new CustomerCompletionRejected('conflict');

 const updated=await client.query<{version:number}>(`
  UPDATE service_requests SET status='COMPLETED',version=version+1
  WHERE id=$1::uuid AND status='ACCEPTED' AND version=$2
  RETURNING version
 `,[id,expectedVersion]);
 if(!updated.rows[0])throw new CustomerCompletionRejected('conflict');

 // Only a customer's own confirmation creates the review-eligible experience.
 await client.query(`
  INSERT INTO service_experiences
   (id,request_id,customer_id,status,confirmed_at)
  VALUES($1::uuid,$2::uuid,$3::uuid,'CONFIRMED',now())
 `,[randomUUID(),id,customer]);

 await client.query(`
  INSERT INTO service_request_events(id,request_id,kind,actor_id,detail)
  VALUES($1::uuid,$2::uuid,'COMPLETED',$3::uuid,'{}'::jsonb)
 `,[randomUUID(),id,customer]);
 const eventId=randomUUID();
 await client.query(`
  INSERT INTO domain_outbox_events
   (id,topic,subject_kind,subject_id,safe_payload)
  VALUES($1::uuid,'service_request.completed','ServiceRequest',
   $2::uuid,'{}'::jsonb)
 `,[eventId,id]);
 // The seller receives an internal notification; no guest or personal data
 // is ever put in the event payload.
 await client.query(`
  INSERT INTO notification_intents
   (id,domain_event_id,recipient_person_id,recipient_org_id,
    audience,channel,dedupe_key)
  VALUES($1::uuid,$2::uuid,
    (SELECT person_id FROM professional_profiles WHERE id=$3::uuid),
    $4::uuid,'SELLER','IN_APP',$5)
 `,[randomUUID(),eventId,row.seller_professional_id,
   row.seller_organization_id,'request-completed:seller:'+id]);
 return {id,state:'completed',version:updated.rows[0].version};
}
