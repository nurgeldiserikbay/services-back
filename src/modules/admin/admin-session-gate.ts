/**
 * Authorization gate for a previously verified admin session record.
 * This does NOT validate a bearer token or load a session from the database.
 * Call only after matching the stored token hash using adminSessionHashMatches.
 */
export type AdminSessionGateInput=Readonly<{
 now:Date;
 expiresAt:Date;
 revokedAt:Date|null;
 mfaVerifiedAt:Date|null;
 staffDisabledAt:Date|null;
 userStatus:string;
 role:string;
 grants:readonly string[];
 requiredScope:string;
}>;

export function adminSessionAllowsAction(input:AdminSessionGateInput):boolean{
 if(!input||!(input.now instanceof Date)||!Number.isFinite(input.now.getTime())||
  !(input.expiresAt instanceof Date)||!Number.isFinite(input.expiresAt.getTime())||
  !(input.mfaVerifiedAt instanceof Date)||!Number.isFinite(input.mfaVerifiedAt.getTime())||
  input.mfaVerifiedAt.getTime()>input.now.getTime()||
  input.expiresAt.getTime()<=input.now.getTime()||
  (input.revokedAt!==null)||
  (input.staffDisabledAt!==null)||
  input.userStatus!=='ACTIVE'||
  !['OWNER','ADMIN','OPERATOR','AUDITOR'].includes(input.role)||
  typeof input.requiredScope!=='string'||!/^[-a-z0-9:.]{1,80}$/.test(input.requiredScope)||
  !Array.isArray(input.grants))return false;
 return input.grants.includes(input.requiredScope);
}
