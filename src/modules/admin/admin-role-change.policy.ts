import {
 canPerformAdminOperation,
 type PlatformRole,
 type VerifiedAdminPrincipal,
} from './admin-authorization.policy.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANAGED_ROLES=new Set<PlatformRole>(['admin','operator','auditor']);

/**
 * Conservative role assignment policy for a future transactional admin API.
 *
 * All principal data and target's existing role MUST come from authoritative
 * server storage, not request body. This does not apply a database mutation.
 * Owner creation, demotion and recovery require a separately reviewed flow.
 */
export function canChangePlatformRole(
 principal:VerifiedAdminPrincipal|null|undefined,
 targetUserId:unknown,
 existingRole:unknown,
 requestedRole:unknown,
 now=Date.now(),
):boolean{
 if(typeof targetUserId!=='string'||!UUID.test(targetUserId)||
  !principal||typeof principal.userId!=='string'||!UUID.test(principal.userId)||
  principal.userId.toLowerCase()===targetUserId.toLowerCase()||
  !MANAGED_ROLES.has(existingRole as PlatformRole)||
  !MANAGED_ROLES.has(requestedRole as PlatformRole)||
  existingRole===requestedRole)return false;

 // Bind authorization to the exact intended target. No wildcard scopes.
 // Server must load grants and verify the same target in the write transaction.
 return canPerformAdminOperation(
  principal,'platform_roles.manage',
  'platform_roles:'+targetUserId.toLowerCase(),now,
 );
}
