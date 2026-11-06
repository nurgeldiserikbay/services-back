import type {PoolClient} from 'pg';
import {cancelAuthorizedPendingRequest,
  type PendingCancellationResult} from './pending-cancellation.transaction.js';
import {assertAuthorizedProviderCancellation,
  ProviderCancellationForbidden} from './provider-cancellation-authorization.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Internal caller-transaction-owned entry point for PENDING seller cancellation.
 * The caller MUST resolve authenticatedPersonId from a verified ACTIVE account
 * session, enforce CSRF and own BEGIN/COMMIT/ROLLBACK. Never pass a browser
 * supplied person ID. This intentionally has no public HTTP controller.
 *
 * Only the CURRENT original professional owner or organization owner may use
 * this boundary. Scoped admins/operators require a separately reviewed,
 * transaction-verified membership permission resolver. Assigned performers do
 * not gain cancellation authority.
 */
export async function cancelPendingByVerifiedSellerOwner(
  db:Pick<PoolClient,'query'>,
  requestId:string,
  authenticatedPersonId:string,
  expectedVersion:number,
):Promise<PendingCancellationResult>{
  if(!UUID.test(requestId)||!UUID.test(authenticatedPersonId)||
     !Number.isSafeInteger(expectedVersion)||expectedVersion<1)
    throw new ProviderCancellationForbidden();

  const actorId=authenticatedPersonId.toLowerCase();
  // Lock request first. Seller context is immutable, and all competing
  // cancellation/schedule updates must lock this same request row.
  const selected=await db.query<{
    status:string;version:number;
    seller_professional_id:string|null;seller_organization_id:string|null;
  }>(`
    SELECT status::text,version,seller_professional_id::text,
      seller_organization_id::text
    FROM service_requests WHERE id=$1::uuid FOR UPDATE
  `,[requestId]);
  const request=selected.rows[0];
  if(!request)throw new ProviderCancellationForbidden();

  if(request.status!=='PENDING'||request.version!==expectedVersion)
    throw new ProviderCancellationForbidden();

  // Recheck user/account status INSIDE the caller's transaction. A stale
  // externally supplied authorization decision is never sufficient.
  const active=await db.query<{person_id:string}>(`
    SELECT p.id::text AS person_id FROM persons p
    JOIN users u ON u.id=p.user_id
    WHERE p.id=$1::uuid AND u.status='ACTIVE'
    FOR SHARE OF p,u
  `,[actorId]);
  if(active.rows[0]?.person_id?.toLowerCase()!==actorId)
    throw new ProviderCancellationForbidden();

  let sellerId:string,kind:'professional'|'organization';
  if(request.seller_professional_id&&!request.seller_organization_id){
    const owned=await db.query<{id:string}>(`
      SELECT id::text FROM professional_profiles
      WHERE id=$1::uuid AND person_id=$2::uuid
      FOR SHARE
    `,[request.seller_professional_id,actorId]);
    if(owned.rows[0]?.id?.toLowerCase()!==
       request.seller_professional_id.toLowerCase())
      throw new ProviderCancellationForbidden();
    sellerId=request.seller_professional_id;
    kind='professional';
    assertAuthorizedProviderCancellation({
      personId:actorId,professionalProfileId:sellerId,
      organizationMembership:null,
    },{professionalId:sellerId,organizationId:null});
  }else if(request.seller_organization_id&&!request.seller_professional_id){
    const owned=await db.query<{id:string}>(`
      SELECT id::text FROM organizations
      WHERE id=$1::uuid AND owner_person_id=$2::uuid
        AND status='ACTIVE'
      FOR SHARE
    `,[request.seller_organization_id,actorId]);
    if(owned.rows[0]?.id?.toLowerCase()!==
       request.seller_organization_id.toLowerCase())
      throw new ProviderCancellationForbidden();
    sellerId=request.seller_organization_id;
    kind='organization';
    // Verified, live organization ownership is stronger than membership.
    assertAuthorizedProviderCancellation({
      personId:actorId,professionalProfileId:null,
      organizationMembership:{
        organizationId:sellerId,role:'OWNER',status:'ACTIVE',
        canManageRequests:true,
      },
    },{professionalId:null,organizationId:sellerId});
  }else throw new ProviderCancellationForbidden();

  // Reuses the existing atomic PENDING cancellation write unit: state/version,
  // audit, outbox and TWO notification intents in the same transaction.
  // Authorization is intentionally rechecked, not trusted from client JSON.
  return cancelAuthorizedPendingRequest(db,requestId,{
    side:'provider',kind,sellerId,
  },expectedVersion);
}
