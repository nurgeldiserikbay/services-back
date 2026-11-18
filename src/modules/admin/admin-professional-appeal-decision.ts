import {BadRequestException,ConflictException,UnauthorizedException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {resolvePlatformAdminSession} from './admin-session-resolver.js';
import {canPerformAdminOperation} from './admin-authorization.policy.js';
import {hashAdminSessionToken} from './admin-session-token.js';

type Db=Pick<PoolClient,'query'>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Outcome='UPHOLD_REJECTION'|'OVERTURN_REJECTION';
type Command={appealId:string;profileId:string;profileVersion:number;outcome:Outcome};
export type AppealReceipt={appeal_id:string;profile_id:string;profile_version:number;outcome:Outcome};

/** Internal core only. No HTTP exposure or default-on activation. */
export function parseProfessionalAppealDecision(appealId:unknown,body:unknown):Command{
 if(typeof appealId!=='string'||!UUID.test(appealId)||!body||typeof body!=='object'||
  Array.isArray(body)||Object.getPrototypeOf(body)!==Object.prototype)
  throw new BadRequestException('Invalid appeal decision');
 const row=body as Record<string,unknown>;
 if(Object.keys(row).sort().join(',')!=='outcome,profile_id,profile_version'||
  typeof row.profile_id!=='string'||!UUID.test(row.profile_id)||
  typeof row.profile_version!=='number'||!Number.isSafeInteger(row.profile_version)||
  row.profile_version<1||row.profile_version>2147483646||
  (row.outcome!=='UPHOLD_REJECTION'&&row.outcome!=='OVERTURN_REJECTION'))
  throw new BadRequestException('Invalid appeal decision');
 return {appealId:appealId.toLowerCase(),profileId:row.profile_id.toLowerCase(),
  profileVersion:row.profile_version,outcome:row.outcome};
}

/** Must be called within a genuine DB transaction. Do not expose over HTTP
 * without approved independent appeal policy, BFF/CSRF, and staging sign-off.
 * This stores immutable outcome evidence; it never changes publication flags.
 */
export async function decideProfessionalAppeal(
 db:Db,bearer:unknown,pepper:Buffer,appealId:unknown,body:unknown,
):Promise<AppealReceipt>{
 const cmd=parseProfessionalAppealDecision(appealId,body);
 const scope='professional:'+cmd.profileId;
 const now=Date.now();
 const principal=await resolvePlatformAdminSession(db,bearer,pepper,now);
 if(!principal||!canPerformAdminOperation(principal,'moderation.appeal.decide',scope,now))
  throw new UnauthorizedException('Authentication required');
 const tokenHash=hashAdminSessionToken(bearer,pepper);
 const authority=await db.query<{staff_id:string}>(`
  SELECT staff.id::text AS staff_id FROM platform_admin_sessions session
  JOIN platform_admin_staff staff ON staff.id=session.staff_id
  JOIN users account ON account.id=staff.user_id
  JOIN platform_admin_grants grant_row ON grant_row.staff_id=staff.id
  JOIN platform_admin_totp_factors factor ON factor.staff_id=staff.id
  WHERE session.token_hash=$1 AND staff.user_id=$2::uuid
   AND grant_row.scope=$3 AND staff.role IN ('owner','admin')
   AND staff.disabled_at IS NULL AND account.status='ACTIVE'
   AND factor.activated_at IS NOT NULL AND factor.disabled_at IS NULL
   AND factor.activated_at<=session.mfa_verified_at
   AND session.revoked_at IS NULL
   AND session.expires_at>clock_timestamp()
   AND session.mfa_verified_at<=clock_timestamp()
   AND session.mfa_verified_at>=clock_timestamp()-interval '15 minutes'
  FOR SHARE OF session,staff,account,grant_row,factor`,[tokenHash,principal.userId,scope]);
 if(authority?.rows.length!==1||!authority.rows[0]?.staff_id)
  throw new UnauthorizedException('Authentication required');
 const staffId=authority.rows[0].staff_id;
 const profile=await db.query<{version:number}>(
  'SELECT version FROM professional_profiles WHERE id=$1::uuid FOR SHARE',[cmd.profileId]);
 if(profile?.rows.length!==1||profile.rows[0]?.version!==cmd.profileVersion)
  throw new ConflictException('Profile version conflict');
 // Consistent profile -> appeal case lock order.
 const appeal=await db.query<{
  case_id:string;profile_id:string;profile_version:number;original_actor:string;original_decision:string;
 }>(`SELECT a.case_id::text,a.profile_id::text,a.profile_version,
   d.actor_staff_id::text AS original_actor,d.decision AS original_decision
  FROM professional_moderation_appeals a
  JOIN professional_moderation_decisions d ON d.id=a.original_decision_id
  WHERE a.id=$1::uuid FOR SHARE OF a,d`,[cmd.appealId]);
 const a=appeal?.rows[0];
 if(appeal?.rows.length!==1||!a||a.profile_id!==cmd.profileId||
  a.profile_version!==cmd.profileVersion||a.original_decision!=='REJECT'||
  a.original_actor===staffId)
  throw new ConflictException('Independent appeal reviewer required');
 // An explicit immutable, independent assignment is mandatory; a role plus
 // resource grant alone never authorizes an appeal outcome.
 const allocation=await db.query<{reviewer_staff_id:string}>(`
  SELECT reviewer_staff_id::text FROM professional_appeal_review_assignments
  WHERE appeal_id=$1::uuid FOR SHARE`,[cmd.appealId]);
 if(allocation?.rows.length!==1||allocation.rows[0]?.reviewer_staff_id!==staffId)
  throw new ConflictException('Independent appeal assignment required');
 const moderation=await db.query<{state:string;resource_scope:string;subject_kind:string}>(
  'SELECT state,resource_scope,subject_kind FROM platform_moderation_cases WHERE id=$1::uuid FOR UPDATE',[a.case_id]);
 const m=moderation?.rows[0];
 if(moderation?.rows.length!==1||!m||m.resource_scope!==scope||m.subject_kind!=='professional')
  throw new ConflictException('Appeal case unavailable');
 if(m.state==='closed'){
  const prior=await db.query<{reviewer_staff_id:string;outcome:string}>(`
   SELECT reviewer_staff_id::text,outcome FROM professional_moderation_appeal_decisions
   WHERE appeal_id=$1::uuid`,[cmd.appealId]);
  if(prior?.rows.length===1&&prior.rows[0]?.reviewer_staff_id===staffId&&prior.rows[0]?.outcome===cmd.outcome)
   return {appeal_id:cmd.appealId,profile_id:cmd.profileId,profile_version:cmd.profileVersion,outcome:cmd.outcome};
  throw new ConflictException('Appeal already decided');
 }
 if(m.state!=='decision')throw new ConflictException('Appeal is not ready for decision');
 const changed=await db.query(
  "UPDATE platform_moderation_cases SET state='closed' WHERE id=$1::uuid AND state='decision'",[a.case_id]);
 if(changed.rowCount!==1)throw new ConflictException('Appeal case state conflict');
 await db.query(
  'INSERT INTO professional_moderation_appeal_decisions(id,appeal_id,reviewer_staff_id,outcome) VALUES($1::uuid,$2::uuid,$3::uuid,$4)',
  [randomUUID(),cmd.appealId,staffId,cmd.outcome]);
 return {appeal_id:cmd.appealId,profile_id:cmd.profileId,profile_version:cmd.profileVersion,outcome:cmd.outcome};
}
