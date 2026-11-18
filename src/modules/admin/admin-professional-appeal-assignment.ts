import {BadRequestException,ConflictException,UnauthorizedException} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {resolvePlatformAdminSession} from './admin-session-resolver.js';
import {canPerformAdminOperation} from './admin-authorization.policy.js';
import {hashAdminSessionToken} from './admin-session-token.js';

type Db=Pick<PoolClient,'query'>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Command={appealId:string;profileId:string;profileVersion:number;reviewerStaffId:string};
export type AssignmentReceipt={appeal_id:string;reviewer_staff_id:string;assigned_by_staff_id:string};

/** Strict internal command. Never trust reviewer/assigner role from request body. */
export function parseAppealReviewerAssignment(appealId:unknown,body:unknown):Command{
 if(typeof appealId!=='string'||!UUID.test(appealId)||!body||typeof body!=='object'||
   Array.isArray(body)||Object.getPrototypeOf(body)!==Object.prototype)
  throw new BadRequestException('Invalid appeal assignment');
 const row=body as Record<string,unknown>;
 if(Object.keys(row).sort().join(',')!=='profile_id,profile_version,reviewer_staff_id'||
   typeof row.profile_id!=='string'||!UUID.test(row.profile_id)||
   typeof row.reviewer_staff_id!=='string'||!UUID.test(row.reviewer_staff_id)||
   typeof row.profile_version!=='number'||!Number.isSafeInteger(row.profile_version)||
   row.profile_version<1||row.profile_version>2147483646)
  throw new BadRequestException('Invalid appeal assignment');
 return {appealId:appealId.toLowerCase(),profileId:row.profile_id.toLowerCase(),
  profileVersion:row.profile_version,reviewerStaffId:row.reviewer_staff_id.toLowerCase()};
}

/** Transaction-only prepared assignment boundary; no HTTP route or activation.
 * Reviewer eligibility and scope are checked live, not from client claims.
 */
export async function assignProfessionalAppealReviewer(
 db:Db,bearer:unknown,pepper:Buffer,appealId:unknown,body:unknown,
):Promise<AssignmentReceipt>{
 const cmd=parseAppealReviewerAssignment(appealId,body);
 const scope='professional:'+cmd.profileId;
 const now=Date.now();
 const principal=await resolvePlatformAdminSession(db,bearer,pepper,now);
 if(!principal||!canPerformAdminOperation(principal,'moderation.appeal.assign',scope,now))
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
   AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp()
   AND session.mfa_verified_at<=clock_timestamp()
   AND session.mfa_verified_at>=clock_timestamp()-interval '15 minutes'
  FOR SHARE OF session,staff,account,grant_row,factor`,[tokenHash,principal.userId,scope]);
 if(authority?.rows.length!==1||!authority.rows[0]?.staff_id)
  throw new UnauthorizedException('Authentication required');
 const assigner=authority.rows[0].staff_id;
 if(assigner===cmd.reviewerStaffId)throw new ConflictException('Independent assignment required');
 const profile=await db.query<{version:number}>(
  'SELECT version FROM professional_profiles WHERE id=$1::uuid FOR SHARE',[cmd.profileId]);
 if(profile?.rows.length!==1||profile.rows[0]?.version!==cmd.profileVersion)
  throw new ConflictException('Profile version conflict');
 const appeal=await db.query<{case_id:string;profile_id:string;profile_version:number;initial_actor:string;decision:string}>(`
  SELECT a.case_id::text,a.profile_id::text,a.profile_version,
   d.actor_staff_id::text AS initial_actor,d.decision
  FROM professional_moderation_appeals a
  JOIN professional_moderation_decisions d ON d.id=a.original_decision_id
  WHERE a.id=$1::uuid FOR SHARE OF a,d`,[cmd.appealId]);
 const a=appeal?.rows[0];
 if(appeal?.rows.length!==1||!a||a.profile_id!==cmd.profileId||
  a.profile_version!==cmd.profileVersion||a.decision!=='REJECT'||
  a.initial_actor===assigner||a.initial_actor===cmd.reviewerStaffId)
  throw new ConflictException('Independent assignment required');
 const reviewer=await db.query<{staff_id:string}>(`
  SELECT staff.id::text AS staff_id FROM platform_admin_staff staff
  JOIN users account ON account.id=staff.user_id
  JOIN platform_admin_grants grant_row ON grant_row.staff_id=staff.id
  JOIN platform_admin_totp_factors factor ON factor.staff_id=staff.id
  WHERE staff.id=$1::uuid AND grant_row.scope=$2
   AND staff.role IN ('owner','admin')
   AND staff.disabled_at IS NULL AND account.status='ACTIVE'
   AND factor.activated_at IS NOT NULL AND factor.disabled_at IS NULL
  FOR SHARE OF staff,account,grant_row,factor`,[cmd.reviewerStaffId,scope]);
 if(reviewer?.rows.length!==1||reviewer.rows[0]?.staff_id!==cmd.reviewerStaffId)
  throw new ConflictException('Reviewer not eligible');
 const moderation=await db.query<{state:string;resource_scope:string;subject_kind:string}>(
  'SELECT state,resource_scope,subject_kind FROM platform_moderation_cases WHERE id=$1::uuid FOR UPDATE',[a.case_id]);
 const m=moderation?.rows[0];
 if(moderation?.rows.length!==1||!m||m.resource_scope!==scope||
  m.subject_kind!=='professional'||!['appeal','decision'].includes(m.state))
  throw new ConflictException('Appeal unavailable for assignment');
 const existing=await db.query<{reviewer_staff_id:string;assigned_by_staff_id:string}>(`
  SELECT reviewer_staff_id::text,assigned_by_staff_id::text
  FROM professional_appeal_review_assignments WHERE appeal_id=$1::uuid FOR SHARE`,[cmd.appealId]);
 if(existing?.rows.length===1){
  if(existing.rows[0]?.reviewer_staff_id===cmd.reviewerStaffId&&
     existing.rows[0]?.assigned_by_staff_id===assigner)
   return {appeal_id:cmd.appealId,reviewer_staff_id:cmd.reviewerStaffId,assigned_by_staff_id:assigner};
  throw new ConflictException('Appeal reviewer already assigned');
 }
 if(!existing||existing.rows.length!==0)throw new ConflictException('Appeal assignment unavailable');
 await db.query(
  'INSERT INTO professional_appeal_review_assignments(appeal_id,reviewer_staff_id,assigned_by_staff_id) VALUES($1::uuid,$2::uuid,$3::uuid)',
  [cmd.appealId,cmd.reviewerStaffId,assigner]);
 return {appeal_id:cmd.appealId,reviewer_staff_id:cmd.reviewerStaffId,assigned_by_staff_id:assigner};
}
