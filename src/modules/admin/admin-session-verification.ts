import {adminSessionHashMatches} from './admin-session-token.js';

export type AdminRole='owner'|'admin'|'operator'|'auditor';
export type AdminSessionRecord={
  token_hash:unknown;
  role:unknown;
  user_id:unknown;
  expires_at:unknown;
  revoked_at:unknown;
  mfa_verified_at:unknown;
};

/**
 * Fail-closed verification of an already loaded privileged session record.
 * The caller MUST load the record from the admin session store using a
 * parameterized query and MUST enforce per-action backend permissions.
 * This helper does not grant access or implement an HTTP authentication route.
 */
export function verifyAdminSessionRecord(
  token:unknown,record:AdminSessionRecord|null|undefined,
  pepper:Buffer,now:Date,
):{userId:string;role:AdminRole}|null{
  if(!record||!(now instanceof Date)||!Number.isFinite(now.getTime()))return null;
  if(typeof record.user_id!=='string'||!/^[-0-9a-f]{36}$/i.test(record.user_id))return null;
  const role=record.role;
  if(role!=='owner'&&role!=='admin'&&role!=='operator'&&role!=='auditor')return null;
  if(record.revoked_at!==null||!(record.expires_at instanceof Date)||
     !Number.isFinite(record.expires_at.getTime())||record.expires_at.getTime()<=now.getTime())return null;
  if(!(record.mfa_verified_at instanceof Date)||
     !Number.isFinite(record.mfa_verified_at.getTime())||
     record.mfa_verified_at.getTime()>now.getTime())return null;
  if(!adminSessionHashMatches(token,record.token_hash,pepper))return null;
  return {userId:record.user_id,role};
}
