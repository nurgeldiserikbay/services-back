import {BadRequestException,UnauthorizedException} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {resolvePlatformAdminSession} from './admin-session-resolver.js';
import {canPerformAdminOperation} from './admin-authorization.policy.js';
import {hashAdminSessionToken} from './admin-session-token.js';

type Db=Pick<PoolClient,'query'>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type AuditEvent={
 event_kind:'REVIEWER_ASSIGNED'|'APPEAL_DECIDED';
 actor_staff_id:string;
 reviewer_staff_id:string;
 outcome:'UPHOLD_REJECTION'|'OVERTURN_REJECTION'|null;
 occurred_at:string;
};
export type AppealAuditReadReceipt={
 appeal_id:string;
 profile_id:string;
 profile_version:number;
 events:AuditEvent[];
};

/** Prepared transaction-only audit read projection; NOT an HTTP endpoint.
 * Never accept profile scope or actor claims from the caller as authority.
 * The profile ID is a required exact resource consistency check only.
 */
export async function readProfessionalAppealAudit(
 db:Db,bearer:unknown,pepper:Buffer,appealId:unknown,profileId:unknown,
):Promise<AppealAuditReadReceipt>{
 if(typeof appealId!=='string'||!UUID.test(appealId)||
   typeof profileId!=='string'||!UUID.test(profileId))
  throw new BadRequestException('Invalid appeal audit request');
 const appeal=appealId.toLowerCase(),profile=profileId.toLowerCase();
 const scope='professional:'+profile,now=Date.now();
 const principal=await resolvePlatformAdminSession(db,bearer,pepper,now);
 if(!principal||!canPerformAdminOperation(principal,'audit.read',scope,now))
  throw new UnauthorizedException('Authentication required');
 const sessionHash=hashAdminSessionToken(bearer,pepper);
 // Recheck live session, MFA, role, scope and account under DB locks.
 // An auditor may read but may never allocate or adjudicate an appeal.
 const authority=await db.query<{staff_id:string}>(`
  SELECT staff.id::text AS staff_id FROM platform_admin_sessions session
  JOIN platform_admin_staff staff ON staff.id=session.staff_id
  JOIN users account ON account.id=staff.user_id
  JOIN platform_admin_grants grant_row ON grant_row.staff_id=staff.id
  JOIN platform_admin_totp_factors factor ON factor.staff_id=staff.id
  WHERE session.token_hash=$1 AND staff.user_id=$2::uuid
   AND grant_row.scope=$3 AND staff.role IN ('owner','admin','auditor')
   AND staff.disabled_at IS NULL AND account.status='ACTIVE'
   AND factor.activated_at IS NOT NULL AND factor.disabled_at IS NULL
   AND factor.activated_at<=session.mfa_verified_at
   AND session.revoked_at IS NULL
   AND session.expires_at>clock_timestamp()
   AND session.mfa_verified_at<=clock_timestamp()
   AND session.mfa_verified_at>=clock_timestamp()-interval '15 minutes'
  FOR SHARE OF session,staff,account,grant_row,factor`,
  [sessionHash,principal.userId,scope]);
 if(authority?.rows.length!==1||!authority.rows[0]?.staff_id)
  throw new UnauthorizedException('Authentication required');

 // Never disclose audit records across a different profile or revision.
 const subject=await db.query<{profile_id:string;profile_version:number}>(`
  SELECT a.profile_id::text AS profile_id,a.profile_version
  FROM professional_moderation_appeals a
  WHERE a.id=$1::uuid AND a.profile_id=$2::uuid
  FOR SHARE OF a`,[appeal,profile]);
 const row=subject?.rows[0];
 if(subject?.rows.length!==1||!row||
   row.profile_id!==profile||!Number.isSafeInteger(row.profile_version))
  throw new UnauthorizedException('Authentication required');

 const result=await db.query<{
  event_kind:AuditEvent['event_kind'];actor_staff_id:string;
  reviewer_staff_id:string;outcome:AuditEvent['outcome'];occurred_at:Date;
 }>(`SELECT event_kind,actor_staff_id::text,reviewer_staff_id::text,outcome,occurred_at
  FROM professional_appeal_audit_events WHERE appeal_id=$1::uuid
  ORDER BY occurred_at ASC,event_kind ASC LIMIT 3`,[appeal]);
 if(!result||!Array.isArray(result.rows)||result.rows.length>2)
  throw new UnauthorizedException('Authentication required');
 const events:AuditEvent[]=[];
 const seen=new Set<string>();
 for(const item of result.rows){
  if(!item||!['REVIEWER_ASSIGNED','APPEAL_DECIDED'].includes(item.event_kind)||
    seen.has(item.event_kind)||!UUID.test(item.actor_staff_id)||!UUID.test(item.reviewer_staff_id)||
    !(item.occurred_at instanceof Date)||!Number.isFinite(item.occurred_at.getTime())||
    (item.event_kind==='REVIEWER_ASSIGNED'&&item.outcome!==null)||
    (item.event_kind==='APPEAL_DECIDED'&&item.outcome!=='UPHOLD_REJECTION'&&item.outcome!=='OVERTURN_REJECTION'))
   throw new UnauthorizedException('Authentication required');
  seen.add(item.event_kind);
  events.push({
   event_kind:item.event_kind,actor_staff_id:item.actor_staff_id,
   reviewer_staff_id:item.reviewer_staff_id,outcome:item.outcome,
   occurred_at:item.occurred_at.toISOString(),
  });
 }
 return {appeal_id:appeal,profile_id:profile,profile_version:row.profile_version,events};
}
