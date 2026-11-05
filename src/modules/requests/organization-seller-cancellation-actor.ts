import type {PoolClient} from 'pg';
import {assertAuthorizedProviderCancellation,
  ProviderCancellationForbidden,
  type VerifiedSellerCancellationActor,
} from './provider-cancellation-authorization.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const valid=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);

type MemberRow={organization_id:string;role:string;scope:unknown};
const hasExplicitCancelScope=(scope:unknown):boolean=>{
  if(!scope||typeof scope!=='object'||Array.isArray(scope))return false;
  const requests=(scope as Record<string,unknown>).requests;
  return !!requests&&typeof requests==='object'&&!Array.isArray(requests)&&
    (requests as Record<string,unknown>).cancel===true;
};

/**
 * Internal, fail-closed organization seller authorization resolver.
 * The caller MUST authenticate the person from a server-side session, lock the
 * request row first, and own the transaction. Do not call with a browser-supplied
 * identity or organization ID. Do not use a cached membership.
 *
 * Only ACTIVE users, ACTIVE organizations and explicitly granted active
 * ADMIN/OPERATOR memberships are accepted. Owner is authorized from live
 * organizations.owner_person_id, independently of optional membership rows.
 * Unknown/missing scope shapes are DENIED until a documented scope migration.
 */
export async function resolveOrganizationSellerCancellationActor(
  db:Pick<PoolClient,'query'>,
  authenticatedPersonId:string,
  originalSellerOrganizationId:string,
):Promise<VerifiedSellerCancellationActor>{
  if(!valid(authenticatedPersonId)||!valid(originalSellerOrganizationId))
    throw new ProviderCancellationForbidden();
  const personId=authenticatedPersonId.toLowerCase();
  const organizationId=originalSellerOrganizationId.toLowerCase();

  // Lock live account and seller organization rows so concurrent revocation
  // cannot race this transaction's decision.
  const org=await db.query<{owner_person_id:string}>(`
    SELECT o.owner_person_id::text FROM organizations o
    JOIN persons p ON p.id=$2::uuid
    JOIN users u ON u.id=p.user_id
    WHERE o.id=$1::uuid AND o.status='ACTIVE' AND u.status='ACTIVE'
    FOR SHARE OF o,p,u
  `,[organizationId,personId]);
  if(org.rows.length!==1)throw new ProviderCancellationForbidden();

  let role:'OWNER'|'ADMIN'|'OPERATOR';
  if(org.rows[0].owner_person_id.toLowerCase()===personId){
    role='OWNER';
  }else{
    // Explicit scope is required. Role alone never implicitly grants cancel.
    const membership=await db.query<MemberRow>(`
      SELECT m.organization_id::text,m.role::text,m.scope
      FROM organization_members m
      JOIN persons p ON p.user_id=m.user_id
      WHERE m.organization_id=$1::uuid AND p.id=$2::uuid
        AND m.revoked_at IS NULL AND m.role IN ('ADMIN','OPERATOR')
      FOR SHARE OF m,p
    `,[organizationId,personId]);
    // Prevent ambiguous multiple active membership rows from promoting access.
    if(membership.rows.length!==1||
       !hasExplicitCancelScope(membership.rows[0].scope)||
       membership.rows[0].organization_id.toLowerCase()!==organizationId)
      throw new ProviderCancellationForbidden();
    const r=membership.rows[0].role;
    if(r!=='ADMIN'&&r!=='OPERATOR')
      throw new ProviderCancellationForbidden();
    role=r;
  }
  const actor:VerifiedSellerCancellationActor={
    personId,professionalProfileId:null,
    organizationMembership:{organizationId,role,status:'ACTIVE',
      canManageRequests:true},
  };
  assertAuthorizedProviderCancellation(actor,{
    professionalId:null,organizationId,
  });
  return actor;
}
