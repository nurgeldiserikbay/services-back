import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {hashGuestCapability} from '../guest-requests/guest-request.security.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class GuestCompletionRejected extends Error{
 constructor(readonly reason:'not_found'|'conflict'){super(reason);}
}
type RequestRow={
 id:string;guest_contact_id:string|null;customer_person_id:string|null;
 status:string;version:number;seller_professional_id:string|null;
 seller_organization_id:string|null;
};
type ProofRow={id:string;guest_contact_id:string;request_id:string|null};
/**
 * Prepared, caller-transactional, guest-specific completion authority.
 * No route issues or accepts this proof yet. A separate independently verified
 * recovery/OTP step MUST mint request-bound COMPLETE_REQUEST capabilities.
 * READ_CANCEL, CREATE_REQUEST and MANAGE_SCHEDULE tokens cannot authorize it.
 */
export async function confirmGuestRequestCompletion(
 client:Pick<PoolClient,'query'>,
 requestId:string,token:string,expectedVersion:number,secret:Buffer,
):Promise<{id:string;state:'completed';version:number}>{
 if(typeof requestId!=='string'||!UUID.test(requestId)||
  !Number.isSafeInteger(expectedVersion)||expectedVersion<1||
  !Buffer.isBuffer(secret)||secret.length!==32)
  throw new GuestCompletionRejected('not_found');
 let hash:string;
 try{hash=hashGuestCapability('COMPLETE_REQUEST',token,secret);}
 catch{throw new GuestCompletionRejected('not_found');}
 const id=requestId.toLowerCase();
 // Acquire request lock first, then proof row, preserving deterministic order
 // with the status version guard. Never consume a proof on failure.
 const requests=await client.query<RequestRow>(`
 SELECT id::text,guest_contact_id::text,customer_person_id::text,
  status::text,version,seller_professional_id::text,seller_organization_id::text
 FROM service_requests WHERE id=$1::uuid FOR UPDATE`,[id]);
 const row=requests.rows[0];
 if(!row||!row.guest_contact_id||row.customer_person_id)
  throw new GuestCompletionRejected('not_found');
 const proofs=await client.query<ProofRow>(`
 SELECT id::text,guest_contact_id::text,request_id::text
 FROM guest_capabilities
 WHERE token_hash=$1 AND scope='COMPLETE_REQUEST'
 AND consumed_at IS NULL AND expires_at>now()
 FOR UPDATE`,[hash]);
 const proof=proofs.rows[0];
 if(!proof||proof.request_id!==id||
  proof.guest_contact_id!==row.guest_contact_id)
  throw new GuestCompletionRejected('not_found');
 if(row.status!=='ACCEPTED'||row.version!==expectedVersion)
  throw new GuestCompletionRejected('conflict');
 const updated=await client.query<{version:number}>(`
 UPDATE service_requests SET status='COMPLETED',version=version+1
 WHERE id=$1::uuid AND status='ACCEPTED' AND version=$2
 RETURNING version`,[id,expectedVersion]);
 if(!updated.rows[0])throw new GuestCompletionRejected('conflict');
 const consumed=await client.query(`
 UPDATE guest_capabilities SET consumed_at=now()
 WHERE id=$1::uuid AND consumed_at IS NULL RETURNING id`,[proof.id]);
 if(consumed.rowCount!==1)throw new GuestCompletionRejected('conflict');
 await client.query(`
 INSERT INTO service_request_events(id,request_id,kind,actor_id,detail)
 VALUES($1::uuid,$2::uuid,'COMPLETED',NULL,'{"actor":"GUEST"}'::jsonb)
 `,[randomUUID(),id]);
 const eventId=randomUUID();
 await client.query(`
 INSERT INTO domain_outbox_events
 (id,topic,subject_kind,subject_id,safe_payload)
 VALUES($1::uuid,'service_request.completed','ServiceRequest',
 $2::uuid,'{}'::jsonb)`,[eventId,id]);
 await client.query(`
 INSERT INTO notification_intents
 (id,domain_event_id,recipient_person_id,recipient_org_id,
 audience,channel,dedupe_key)
 VALUES($1::uuid,$2::uuid,
 (SELECT person_id FROM professional_profiles WHERE id=$3::uuid),
 $4::uuid,'SELLER','IN_APP',$5)`,
 [randomUUID(),eventId,row.seller_professional_id,
  row.seller_organization_id,'request-completed:seller:'+id]);
 // A guest completion does not create a service_experience: that schema
 // requires a registered Person and would falsely unlock verified reviews.
 return {id,state:'completed',version:updated.rows[0].version};
}
