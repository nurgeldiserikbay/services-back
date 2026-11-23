import {createHmac,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {GuestRequestInput} from '../guest-requests/guest-request.validation.js';
import {checkRegisteredRequestBudget} from './registered-customer-request.budget.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/;

export class RegisteredRequestRejected extends Error{
 constructor(readonly reason:'invalid_actor'|'invalid_input'|'unavailable_offer'|'idempotency_conflict'|'rate_limited'){
  super(reason);
 }
}
export type RegisteredRequestReceipt=Readonly<{id:string;state:'pending';version:1}>;

type Ledger={request_hash:string;state:string;expires_at:Date;response_body:unknown};
type Seller={professional_id:string|null;organization_id:string|null};

function hashInput(input:GuestRequestInput,pepper:Buffer):string{
 return createHmac('sha256',pepper)
  .update('registered-customer-request:v1\0')
  .update(JSON.stringify([input.serviceOfferId,input.note,input.consentToContact]))
  .digest('hex');
}
function readReceipt(value:unknown):RegisteredRequestReceipt{
 if(!value||typeof value!=='object'||Array.isArray(value))
  throw new RegisteredRequestRejected('idempotency_conflict');
 const v=value as Record<string,unknown>;
 if(typeof v.id!=='string'||!UUID.test(v.id)||v.id!==v.id.toLowerCase()||
  v.state!=='pending'||v.version!==1||Object.keys(v).sort().join(',')!=='id,state,version')
  throw new RegisteredRequestRejected('idempotency_conflict');
 return {id:v.id,state:'pending',version:1};
}

/**
 * Prepared, INTERNAL-ONLY creation primitive. The caller MUST resolve a live
 * registered session -> person inside the same transaction before invoking
 * this function, and owns BEGIN/COMMIT/ROLLBACK. No guest capability or
 * frontend cookie is accepted here. This function is not an HTTP endpoint.
 */
export async function createRegisteredCustomerRequestInTransaction(
 client:Pick<PoolClient,'query'>,
 customerPersonId:string,
 input:GuestRequestInput,
 idempotencyKey:string,
 pepper:Buffer,
 now=new Date(),
):Promise<RegisteredRequestReceipt>{
 if(typeof customerPersonId!=='string'||!UUID.test(customerPersonId)||
  typeof idempotencyKey!=='string'||!KEY.test(idempotencyKey)||
  !Buffer.isBuffer(pepper)||pepper.length<32||
  !input||typeof input.serviceOfferId!=='string'||!UUID.test(input.serviceOfferId)||
  (input.note!==null&&(typeof input.note!=='string'||input.note.length>1000||
   /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.note)))||
  input.consentToContact!==true)
  throw new RegisteredRequestRejected('invalid_input');

 const personId=customerPersonId.toLowerCase();
 const offerId=input.serviceOfferId.toLowerCase();
 const customer=await client.query<{id:string}>(`
  SELECT p.id::text FROM persons p JOIN users u ON u.id=p.user_id
  WHERE p.id=$1::uuid FOR SHARE OF p
 `,[personId]);
 if(customer.rows.length!==1||!customer.rows[0])
  throw new RegisteredRequestRejected('invalid_actor');

 const scope='account:'+personId,route='/account/requests',method='POST';
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
  [scope,route+':'+idempotencyKey]);
 const canonical={...input,serviceOfferId:offerId};
 const requestHash=hashInput(canonical,pepper);
 const existing=await client.query<Ledger>(`
  SELECT request_hash,state,response_body,expires_at
  FROM idempotency_records
  WHERE actor_scope=$1 AND method=$2 AND route=$3 AND key=$4
  FOR UPDATE
 `,[scope,method,route,idempotencyKey]);
 const ledger=existing.rows[0];
 if(ledger){
  if(ledger.request_hash!==requestHash||ledger.state!=='COMPLETED'||
   new Date(ledger.expires_at).getTime()<=now.getTime())
   throw new RegisteredRequestRejected('idempotency_conflict');
  return readReceipt(ledger.response_body);
 }

 // Read the committed retry ledger first: a valid repeat does not create
 // another request and must not be denied by the issuance budget.
 const budget=await checkRegisteredRequestBudget(client,personId);
 if(!budget.allowed)
  throw new RegisteredRequestRejected('rate_limited');

 const offer=await client.query<Seller>(`
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
   AND (o.location_id IS NULL OR EXISTS(
    SELECT 1 FROM locations loc WHERE loc.id=o.location_id AND loc.active=true))
  FOR SHARE OF o
 `,[offerId]);
 const seller=offer.rows[0];
 if(!seller)throw new RegisteredRequestRejected('unavailable_offer');
 if(seller.professional_id){
  const profile=await client.query<{id:string}>(`
   SELECT id::text FROM professional_profiles
   WHERE id=$1::uuid AND status='PUBLISHED' FOR SHARE
  `,[seller.professional_id]);
  if(profile.rows.length!==1)
   throw new RegisteredRequestRejected('unavailable_offer');
 }

 // The offer row lock does not protect its independent organization state.
 // Lock the ACTIVE seller row in this same transaction before inserting a
 // customer request; otherwise a concurrent suspension can race creation.
 if(seller.organization_id){
  const activeOrganization=await client.query<{id:string}>(`
   SELECT id::text FROM organizations
   WHERE id=$1::uuid AND status='ACTIVE' FOR SHARE
  `,[seller.organization_id]);
  if(activeOrganization.rows.length!==1)
   throw new RegisteredRequestRejected('unavailable_offer');
 }

 const id=randomUUID(),eventId=randomUUID();
 await client.query(`
  INSERT INTO service_requests
   (id,offer_id,customer_person_id,source_context,
    seller_professional_id,seller_organization_id,status,note)
  VALUES($1::uuid,$2::uuid,$3::uuid,$4::"RequestSourceContext",
   $5::uuid,$6::uuid,'PENDING',$7)
 `,[id,offerId,personId,seller.organization_id?'ORGANIZATION':'PERSONAL',
   seller.professional_id,seller.organization_id,input.note]);
 await client.query(`
  INSERT INTO service_request_events(id,request_id,kind,actor_id,detail)
  VALUES($1::uuid,$2::uuid,'CREATED',$3::uuid,'{}'::jsonb)
 `,[randomUUID(),id,personId]);
 await client.query(`
  INSERT INTO domain_outbox_events(id,topic,subject_kind,subject_id,safe_payload)
  VALUES($1::uuid,'service_request.created','ServiceRequest',$2::uuid,'{}'::jsonb)
 `,[eventId,id]);
 await client.query(`
  INSERT INTO notification_intents
   (id,domain_event_id,recipient_person_id,recipient_org_id,
    audience,channel,dedupe_key)
  VALUES($1::uuid,$2::uuid,
   (SELECT person_id FROM professional_profiles WHERE id=$3::uuid),
   $4::uuid,'SELLER','IN_APP',$5)
 `,[randomUUID(),eventId,seller.professional_id,seller.organization_id,
   'request-created:seller:'+id]);
 const receipt:RegisteredRequestReceipt={id,state:'pending',version:1};
 await client.query(`
  INSERT INTO idempotency_records
   (id,actor_scope,method,route,key,request_hash,state,
    response_status,response_body,expires_at)
  VALUES($1::uuid,$2,$3,$4,$5,$6,'COMPLETED',201,$7::jsonb,
   now()+interval '24 hours')
 `,[randomUUID(),scope,method,route,idempotencyKey,requestHash,
   JSON.stringify(receipt)]);
 return receipt;
}
