/**
 * Platform administration permission policy. This pure core is not an HTTP
 * authentication guard: API endpoints must authenticate a dedicated MFA-backed
 * platform session and call this policy using server-derived principals.
 */
export type PlatformRole='owner'|'admin'|'operator'|'auditor';
export type AdminPermission=
 'moderation:read'|'moderation:decide'|'taxonomy:read'|'taxonomy:publish'|
 'audit:read'|'staff:read'|'staff:manage';

export type PlatformPrincipal=Readonly<{
 userId:string;
 role:PlatformRole;
 mfaVerified:boolean;
 sessionExpiresAt:string;
 disabled:boolean;
}>;

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSIONS:Readonly<Record<PlatformRole,readonly AdminPermission[]>>={
 owner:['moderation:read','moderation:decide','taxonomy:read','taxonomy:publish','audit:read','staff:read','staff:manage'],
 admin:['moderation:read','moderation:decide','taxonomy:read','taxonomy:publish','audit:read','staff:read'],
 operator:['moderation:read','moderation:decide','taxonomy:read'],
 auditor:['moderation:read','taxonomy:read','audit:read'],
};
const VALID_KEYS=['userId','role','mfaVerified','sessionExpiresAt','disabled'];

export function isActivePlatformPrincipal(value:unknown,now=Date.now()):value is PlatformPrincipal{
 if(!Number.isSafeInteger(now)||!value||typeof value!=='object'||Array.isArray(value))
  return false;
 const p=value as Record<string,unknown>;
 if(Object.keys(p).length!==VALID_KEYS.length||
  !VALID_KEYS.every(key=>Object.hasOwn(p,key)))return false;
 return typeof p.userId==='string'&&UUID.test(p.userId)&&
  typeof p.role==='string'&&Object.hasOwn(PERMISSIONS,p.role)&&
  p.mfaVerified===true&&p.disabled===false&&
  typeof p.sessionExpiresAt==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(p.sessionExpiresAt)&&
  Number.isFinite(Date.parse(p.sessionExpiresAt))&&
  Date.parse(p.sessionExpiresAt)>now;
}

export function canPlatformAdmin(
 principal:unknown,permission:AdminPermission,now=Date.now(),
):boolean{
 if(!isActivePlatformPrincipal(principal,now))return false;
 return PERMISSIONS[principal.role].includes(permission);
}

/** A platform role change must not be used for self-promotion. */
export function canManagePlatformStaff(
 principal:unknown,targetUserId:unknown,now=Date.now(),
):boolean{
 return typeof targetUserId==='string'&&UUID.test(targetUserId)&&
  isActivePlatformPrincipal(principal,now)&&
  principal.userId.toLowerCase()!==targetUserId.toLowerCase()&&
  canPlatformAdmin(principal,'staff:manage',now);
}
