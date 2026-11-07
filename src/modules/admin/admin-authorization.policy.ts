/**
 * Deny-by-default policy for future platform admin endpoints.
 * Principal MUST come from an authenticated, MFA-verified server session,
 * never untrusted request input. Not a session verifier or HTTP guard.
 */
export type PlatformRole='owner'|'admin'|'operator'|'auditor';
export type AdminOperation=
  |'moderation.read'|'moderation.decide'|'audit.read'
  |'taxonomy.read'|'taxonomy.publish'
  |'platform_roles.read'|'platform_roles.manage';
export type VerifiedAdminPrincipal=Readonly<{
  userId:string;
  role:PlatformRole;
  sessionExpiresAt:number;
  mfaVerifiedAt:number;
  resourceScopes:readonly string[];
}>;

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE=/^[a-z][a-z0-9_-]{0,31}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MFA_AGE_MS=15*60*1000;
const ALLOWED:Readonly<Record<PlatformRole,readonly AdminOperation[]>>={
  owner:['moderation.read','moderation.decide','audit.read','taxonomy.read',
    'taxonomy.publish','platform_roles.read','platform_roles.manage'],
  admin:['moderation.read','moderation.decide','audit.read','taxonomy.read',
    'taxonomy.publish','platform_roles.read'],
  operator:['moderation.read','moderation.decide','taxonomy.read'],
  auditor:['moderation.read','audit.read','taxonomy.read'],
};
const VALID_OPERATIONS=new Set<AdminOperation>(ALLOWED.owner);

/**
 * Caller must also verify resource state in the database and enforce
 * write idempotency, CSRF and audit logging. Grant data must be authoritative.
 */
export function canPerformAdminOperation(
  principal:VerifiedAdminPrincipal|null|undefined,
  operation:AdminOperation,
  resourceScope:string,
  now=Date.now(),
):boolean{
  if(!principal||!Number.isSafeInteger(now)||
    !Number.isSafeInteger(principal.sessionExpiresAt)||
    !Number.isSafeInteger(principal.mfaVerifiedAt)||
    typeof principal.userId!=='string'||!UUID.test(principal.userId)||
    !Object.hasOwn(ALLOWED,principal.role)||
    !VALID_OPERATIONS.has(operation)||
    typeof resourceScope!=='string'||!SCOPE.test(resourceScope)||
    !Array.isArray(principal.resourceScopes)||
    principal.resourceScopes.length>100)return false;

  if(principal.sessionExpiresAt<=now||
    principal.mfaVerifiedAt>now||
    now-principal.mfaVerifiedAt>MAX_MFA_AGE_MS)return false;

  // Every role, including owner, requires an explicit server-issued scope.
  return ALLOWED[principal.role].includes(operation)&&
    principal.resourceScopes.some(scope=>
      typeof scope==='string'&&scope===resourceScope);
}
