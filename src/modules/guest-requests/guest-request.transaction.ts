import {createHmac, randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {
  decryptGuestContact, encryptGuestContact, hashGuestCapability, issueGuestCapability,
} from './guest-request.security.js';
import type {GuestRequestInput} from './guest-request.validation.js';

/**
 * Application-domain transaction core, NOT a public HTTP endpoint.
 *
 * Caller MUST open BEGIN, invoke this function and COMMIT (or ROLLBACK on error)
 * on the SAME client. No outbound notification is sent here. The request,
 * capability, event, seller notification intent and encrypted idempotency reply
 * are committed atomically. No raw contact, OTP, request capability or note
 * appears in outbox event payloads or the idempotency ledger.
 */
export class GuestRequestRejected extends Error {
  constructor(readonly reason:'invalid_proof'|'unavailable_offer'|'idempotency_conflict') {
    super(reason);
  }
}

export type CreatedGuestRequest = {
  id: string;
  state: 'pending';
  requestCapability: string;
  expiresAt: string;
};

type ProofRow={
  id:string; guest_contact_id:string; consumed_at:Date|null;
  expires_at:Date; verified_at:Date|null; contact_expires_at:Date;
};
type LedgerRow={
  request_hash:string;state:string;expires_at:Date;
  response_body:unknown;
};
type SellerRow={professional_id:string|null;organization_id:string|null};
type IdRow={id:string};

function hmacPayload(input:GuestRequestInput,pepper:Buffer):string {
  return createHmac('sha256',pepper).update('guest-request-body:v1\0')
    .update(JSON.stringify([input.serviceOfferId,input.note,input.consentToContact]))
    .digest('hex');
}

function restoreReply(json:unknown,key:Buffer):CreatedGuestRequest {
  if (!json || typeof json!=='object' || Array.isArray(json)) {
    throw new Error('invalid_encrypted_idempotency_reply');
  }
  const payload=(json as Record<string,unknown>).ciphertext;
  if(typeof payload!=='string')throw new Error('invalid_encrypted_idempotency_reply');
  const data:unknown=JSON.parse(decryptGuestContact(payload,key));
  if(!data || typeof data!=='object' || Array.isArray(data))throw new Error('invalid_idempotency_reply');
  const result=data as Record<string,unknown>;
  if (typeof result.id!=='string' || result.state!=='pending' ||
      typeof result.requestCapability!=='string' || typeof result.expiresAt!=='string') {
    throw new Error('invalid_idempotency_reply');
  }
  return result as CreatedGuestRequest;
}

export async function createGuestRequestInTransaction(
  client:Pick<PoolClient,'query'>,
  input:GuestRequestInput,
  createCapabilityToken:string,
  idempotencyKey:string,
  pepper:Buffer,
  encryptionKey:Buffer,
  now=new Date(),
):Promise<CreatedGuestRequest> {
  // The caller validates the request body and key, requires a verified OTP
  // capability, and owns the surrounding BEGIN/COMMIT/ROLLBACK.
  const tokenHash=hashGuestCapability('CREATE_REQUEST',createCapabilityToken,pepper);
  const proofResult=await client.query<ProofRow>(`
    SELECT cap.id::text,cap.guest_contact_id::text,cap.consumed_at,
           cap.expires_at,contact.verified_at,
           contact.expires_at AS contact_expires_at
    FROM guest_capabilities cap
    JOIN guest_contacts contact ON contact.id=cap.guest_contact_id
    WHERE cap.token_hash=$1 AND cap.scope='CREATE_REQUEST'
    FOR UPDATE OF cap
  `,[tokenHash]);
  const proof=proofResult.rows[0];
  if(!proof)throw new GuestRequestRejected('invalid_proof');

  const actorScope='guest:'+proof.guest_contact_id;
  const route='/guest-requests',method='POST';
  // Serializes duplicate keys even when two different create tokens were
  // verified for the same contact concurrently.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    [actorScope,route+':'+idempotencyKey]);
  const requestHash=hmacPayload(input,pepper);
  const existing=await client.query<LedgerRow>(`
    SELECT request_hash,state,response_body,expires_at
    FROM idempotency_records
    WHERE actor_scope=$1 AND method=$2 AND route=$3 AND key=$4
    FOR UPDATE
  `,[actorScope,method,route,idempotencyKey]);
  const ledger=existing.rows[0];
  if(ledger){
    if (ledger.request_hash!==requestHash || ledger.state!=='COMPLETED' ||
        ledger.expires_at.getTime()<=now.getTime()) {
      throw new GuestRequestRejected('idempotency_conflict');
    }
    return restoreReply(ledger.response_body,encryptionKey);
  }
  if(proof.consumed_at || proof.expires_at.getTime()<=now.getTime() ||
     !proof.verified_at || proof.contact_expires_at.getTime()<=now.getTime()) {
    throw new GuestRequestRejected('invalid_proof');
  }

  // Seller ownership is derived exclusively from the canonical offer, never
  // from request input or claimed client context. Lock offer against a
  // concurrent unpublish/update for the duration of this transaction.
  const offerResult=await client.query<SellerRow>(`
    SELECT o.professional_id::text,o.organization_id::text
    FROM service_offers o
    WHERE o.id=$1::uuid AND o.status='PUBLISHED'
      AND (
        (o.professional_id IS NOT NULL AND o.organization_id IS NULL
          AND EXISTS(SELECT 1 FROM professional_profiles p
                     WHERE p.id=o.professional_id AND p.status='PUBLISHED'))
        OR
        (o.organization_id IS NOT NULL AND o.professional_id IS NULL
          AND EXISTS(SELECT 1 FROM organizations org
                     WHERE org.id=o.organization_id AND org.status='ACTIVE'))
      )
      AND (o.location_id IS NULL OR EXISTS (
        SELECT 1 FROM locations loc WHERE loc.id=o.location_id AND loc.active=true))
    FOR SHARE OF o
  `,[input.serviceOfferId]);
  const seller=offerResult.rows[0];
  if(!seller)throw new GuestRequestRejected('unavailable_offer');

  const id=randomUUID(),eventId=randomUUID();
  const source=seller.organization_id?'ORGANIZATION':'PERSONAL';
  await client.query(`
    INSERT INTO service_requests
      (id,offer_id,guest_contact_id,source_context,
       seller_professional_id,seller_organization_id,status,note)
    VALUES ($1::uuid,$2::uuid,$3::uuid,$4::"RequestSourceContext",
            $5::uuid,$6::uuid,'PENDING',$7)
  `,[id,input.serviceOfferId,proof.guest_contact_id,source,
    seller.professional_id,seller.organization_id,input.note]);
  await client.query(`
    INSERT INTO service_request_events(id,request_id,kind,detail)
    VALUES($1::uuid,$2::uuid,'CREATED','{}'::jsonb)
  `,[randomUUID(),id]);
  await client.query(`
    INSERT INTO domain_outbox_events(id,topic,subject_kind,subject_id,safe_payload)
    VALUES($1::uuid,'service_request.created','ServiceRequest',$2::uuid,'{}'::jsonb)
  `,[eventId,id]);

  // The professional's Person ID is internal to the database, and the
  // notification worker must enforce ACL. No PII in outbox safe_payload.
  await client.query(`
    INSERT INTO notification_intents(
      id,domain_event_id,recipient_person_id,recipient_org_id,
      audience,channel,dedupe_key)
    VALUES(
      $1::uuid,$2::uuid,
      (SELECT person_id FROM professional_profiles WHERE id=$3::uuid),
      $4::uuid,'SELLER','IN_APP',$5)
  `,[randomUUID(),eventId,seller.professional_id,seller.organization_id,
    'request-created:seller:'+id]);

  const proofToken=issueGuestCapability('READ_CANCEL',pepper);
  const expiresAt=new Date(now.getTime()+30*24*60*60*1000);
  await client.query(`
    INSERT INTO guest_capabilities
      (id,guest_contact_id,request_id,scope,token_hash,expires_at)
    VALUES($1::uuid,$2::uuid,$3::uuid,'READ_CANCEL',$4,$5)
  `,[randomUUID(),proof.guest_contact_id,id,proofToken.tokenHash,expiresAt]);
  await client.query(`
    UPDATE guest_capabilities SET consumed_at=now()
    WHERE id=$1::uuid AND scope='CREATE_REQUEST' AND consumed_at IS NULL
  `,[proof.id]);
  const reply:CreatedGuestRequest={
    id,state:'pending',requestCapability:proofToken.token,expiresAt:expiresAt.toISOString(),
  };
  await client.query(`
    INSERT INTO idempotency_records (
      id,actor_scope,method,route,key,request_hash,
      state,response_status,response_body,expires_at)
    VALUES($1::uuid,$2,$3,$4,$5,$6,'COMPLETED',201,$7::jsonb,
           now()+interval '24 hours')
  `,[randomUUID(),actorScope,method,route,idempotencyKey,requestHash,
      JSON.stringify({ciphertext:encryptGuestContact(JSON.stringify(reply),encryptionKey)})]);
  return reply;
}
