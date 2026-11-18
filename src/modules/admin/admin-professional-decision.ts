import {BadRequestException,ConflictException,UnauthorizedException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {resolvePlatformAdminSession} from './admin-session-resolver.js';
import {canPerformAdminOperation} from './admin-authorization.policy.js';
import {hashAdminSessionToken} from './admin-session-token.js';

type Db=Pick<PoolClient,'query'>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Decision='APPROVE'|'REJECT';
type Command={caseId:string;profileId:string;profileVersion:number;decision:Decision};
export type DecisionReceipt={case_id:string;profile_id:string;profile_version:number;decision:Decision};

/** Strict BFF-only body. Version is bound to the exact owner draft revision. */
export function parseProfessionalDecision(caseId:unknown,body:unknown):Command{
 if(typeof caseId!=='string'||!UUID.test(caseId)||!body||typeof body!=='object'||Array.isArray(body)||
  Object.getPrototypeOf(body)!==Object.prototype)throw new BadRequestException('Invalid decision');
 const row=body as Record<string,unknown>;
 if(Object.keys(row).sort().join(',')!=='decision,profile_id,profile_version'||
  typeof row.profile_id!=='string'||!UUID.test(row.profile_id)||
  !Number.isSafeInteger(row.profile_version)||typeof row.profile_version!=='number'||
  row.profile_version<1||row.profile_version>2147483646||
  (row.decision!=='APPROVE'&&row.decision!=='REJECT'))
  throw new BadRequestException('Invalid decision');
 return {caseId:caseId.toLowerCase(),profileId:row.profile_id.toLowerCase(),
  profileVersion:row.profile_version,decision:row.decision};
}

/**
 * Caller must provide a real transaction. Exact scope grant and fresh MFA are
 * rechecked under PostgreSQL row locks before a decision case is closed.
 * This NEVER changes the publication flag or auto-approves a public profile.
 */
export async function decideProfessionalModerationCase(
 db:Db,bearer:unknown,pepper:Buffer,caseId:unknown,body:unknown,
):Promise<DecisionReceipt>{
 const cmd=parseProfessionalDecision(caseId,body);
 const scope='professional:'+cmd.profileId;
 const now=Date.now();
 const principal=await resolvePlatformAdminSession(db,bearer,pepper,now);
 if(!principal||!canPerformAdminOperation(principal,'moderation.decide',scope,now))
  throw new UnauthorizedException('Authentication required');
 const tokenHash=hashAdminSessionToken(bearer,pepper);
 // Current authority is locked so revocation/grant removal cannot race the
 // write between authorization and decision. The per-scope grant is required
 // even for owner/admin; auditor is never allowed to decide.
 const authority=await db.query<{staff_id:string}>(`
  SELECT staff.id::text AS staff_id
  FROM platform_admin_sessions AS session
  JOIN platform_admin_staff AS staff ON staff.id=session.staff_id
  JOIN users AS account ON account.id=staff.user_id
  JOIN platform_admin_grants AS grant_row ON grant_row.staff_id=staff.id
  JOIN platform_admin_totp_factors AS factor ON factor.staff_id=staff.id
  WHERE session.token_hash=$1 AND staff.user_id=$2::uuid
    AND grant_row.scope=$3 AND staff.role IN ('owner','admin','operator')
    AND staff.disabled_at IS NULL AND account.status='ACTIVE'
    AND factor.activated_at IS NOT NULL AND factor.disabled_at IS NULL
    AND factor.activated_at<=session.mfa_verified_at
    AND session.revoked_at IS NULL
    AND session.expires_at>clock_timestamp()
    AND session.mfa_verified_at<=clock_timestamp()
    AND session.mfa_verified_at>=clock_timestamp()-interval '15 minutes'
  FOR SHARE OF session,staff,account,grant_row,factor`,[tokenHash,principal.userId,scope]);
 if(!authority||authority.rows.length!==1||!authority.rows[0]?.staff_id)
  throw new UnauthorizedException('Authentication required');
 const staffId=authority.rows[0].staff_id;
 // Lock in profile->case order; the decision insert trigger validates the
 // closed case and current version again at the database boundary.
 const profile=await db.query<{version:number}>(
  'SELECT version FROM professional_profiles WHERE id=$1::uuid FOR SHARE',[cmd.profileId]);
 if(!profile||profile.rows.length!==1||profile.rows[0]?.version!==cmd.profileVersion)
  throw new ConflictException('Profile version conflict');
 const moderation=await db.query<{resource_scope:string;subject_kind:string;state:string}>(
  'SELECT resource_scope,subject_kind,state FROM platform_moderation_cases WHERE id=$1::uuid FOR UPDATE',
  [cmd.caseId]);
 const row=moderation?.rows[0];
 if(!row||row.resource_scope!==scope||row.subject_kind!=='professional')
  throw new ConflictException('Moderation case unavailable');
 if(row.state==='closed'){
  const prior=await db.query<{decision:string;profile_version:number;actor_staff_id:string}>(
   'SELECT decision,profile_version,actor_staff_id::text FROM professional_moderation_decisions WHERE case_id=$1::uuid',[cmd.caseId]);
  if(prior?.rows.length===1&&prior.rows[0]?.decision===cmd.decision&&
   prior.rows[0].profile_version===cmd.profileVersion&&prior.rows[0].actor_staff_id===staffId)
   return {case_id:cmd.caseId,profile_id:cmd.profileId,profile_version:cmd.profileVersion,decision:cmd.decision};
  throw new ConflictException('Moderation case already decided');
 }
 if(row.state!=='decision')throw new ConflictException('Moderation case is not ready for decision');
 const result=await db.query(
  "UPDATE platform_moderation_cases SET state='closed' WHERE id=$1::uuid AND state='decision'",
  [cmd.caseId]);
 if(result.rowCount!==1)throw new ConflictException('Moderation case state conflict');
 await db.query(
  'INSERT INTO professional_moderation_decisions(id,case_id,profile_id,profile_version,actor_staff_id,decision) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6)',
  [randomUUID(),cmd.caseId,cmd.profileId,cmd.profileVersion,staffId,cmd.decision]);
 return {case_id:cmd.caseId,profile_id:cmd.profileId,profile_version:cmd.profileVersion,decision:cmd.decision};
}
