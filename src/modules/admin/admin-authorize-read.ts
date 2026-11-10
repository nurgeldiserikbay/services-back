import {verifyAdminSessionRecord,type AdminSessionRecord} from './admin-session-verification.js';
import {canReadAdminResource,type AdminReadCapability} from './admin-read-policy.js';

export type VerifiedAdminReader={userId:string;role:'owner'|'admin'|'operator'|'auditor'};

/**
 * Authorize a read using a verified privileged session, never a role supplied
 * by the client. Callers must fetch the session from trusted storage and
 * separately enforce row-level scope and pagination in their database query.
 * Returns null on every authentication or capability failure.
 */
export function authorizeAdminRead(
  token:unknown,
  session:AdminSessionRecord|null|undefined,
  pepper:Buffer,
  now:Date,
  capability:AdminReadCapability,
):VerifiedAdminReader|null{
  const principal=verifyAdminSessionRecord(token,session,pepper,now);
  if(!principal||!canReadAdminResource(principal.role,capability))return null;
  return principal;
}
