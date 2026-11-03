import type {PoolClient} from 'pg';
import type {SellerIdentity} from './seller-decision.transaction.js';

/**
 * Transaction-scoped seller authorization based on a SERVER-AUTHENTICATED
 * canonical userId. Never derive userId from the request body or URL.
 *
 * Organization OPERATOR is intentionally denied until per-offer scope and
 * assignment grants are implemented. AUDITOR is read-only.
 */
export type SellerAuthorityResult=
  | {authorized:true;seller:SellerIdentity}
  | {authorized:false};

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type SellerRow={professional_id:string|null;organization_id:string|null};
type AuthorizedRow={allowed:boolean};

export async function resolveSellerDecisionAuthority(
  db:Pick<PoolClient,'query'>,
  authenticatedUserId:string,
  requestId:string,
):Promise<SellerAuthorityResult>{
  if(!UUID.test(authenticatedUserId)||!UUID.test(requestId))
    return {authorized:false};

  // SELECT FOR SHARE prevents a concurrent change to the request seller
  // identity while the caller decides on the same transaction.
  const request=await db.query<SellerRow>(`
    SELECT seller_professional_id::text AS professional_id,
           seller_organization_id::text AS organization_id
    FROM service_requests WHERE id=$1::uuid FOR SHARE
  `,[requestId]);
  const row=request.rows[0];
  if(!row || Boolean(row.professional_id)===Boolean(row.organization_id))
    return {authorized:false};

  if(row.professional_id){
    const owner=await db.query<AuthorizedRow>(`
      SELECT true AS allowed
      FROM professional_profiles prof
      JOIN persons person ON person.id=prof.person_id
      JOIN users usr ON usr.id=person.user_id
      WHERE prof.id=$1::uuid AND usr.id=$2::uuid
        AND usr.status='ACTIVE' AND prof.status='PUBLISHED'
      FOR SHARE OF prof, person, usr
    `,[row.professional_id,authenticatedUserId]);
    return owner.rows[0]?.allowed
      ? {authorized:true,seller:{kind:'professional',sellerId:row.professional_id}}
      : {authorized:false};
  }

  const org=await db.query<AuthorizedRow>(`
    SELECT true AS allowed
    FROM organizations org
    JOIN organization_members membership
      ON membership.organization_id=org.id
    JOIN users usr ON usr.id=membership.user_id
    WHERE org.id=$1::uuid AND usr.id=$2::uuid
      AND org.status='ACTIVE' AND usr.status='ACTIVE'
      AND membership.revoked_at IS NULL
      AND membership.role IN ('OWNER','ADMIN')
      AND (membership.scope IS NULL OR membership.scope='{}'::jsonb)
    FOR SHARE OF org, membership, usr
    LIMIT 1
  `,[row.organization_id,authenticatedUserId]);
  return org.rows[0]?.allowed
    ? {authorized:true,seller:{kind:'organization',sellerId:row.organization_id!}}
    : {authorized:false};
}
