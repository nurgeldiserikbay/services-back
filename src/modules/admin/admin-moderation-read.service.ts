import {Inject,Injectable,UnauthorizedException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {resolvePlatformAdminSession} from './admin-session-resolver.js';
import {canPerformAdminOperation} from './admin-authorization.policy.js';
import {extractAdminBearerToken} from './admin-bearer-proof.js';
import {hashAdminSessionToken} from './admin-session-token.js';

type CaseRow={
 id:string;resource_scope:string;subject_kind:string;state:string;created_at:Date;
};
export type ModerationCaseSummary=Readonly<{
 id:string;subjectKind:'professional'|'organization'|'review'|'affiliation';
 state:'triage'|'in_review'|'decision'|'appeal'|'closed';
 createdAt:string;
}>;
const KINDS=new Set(['professional','organization','review','affiliation']);
const STATES=new Set(['triage','in_review','decision','appeal','closed']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validate untrusted database rows before returning any moderation data. */
export function validateModerationCaseRows(
 rows:readonly CaseRow[],allowedScopes:ReadonlySet<string>,
):ModerationCaseSummary[]{
 if(!Array.isArray(rows)||rows.length>50)throw new UnauthorizedException('Authentication required');
 const seen=new Set<string>();
 const items:ModerationCaseSummary[]=[];
 for(const row of rows){
  if(!row||typeof row!=='object'||
   typeof row.id!=='string'||!UUID.test(row.id)||seen.has(row.id.toLowerCase())||
   !KINDS.has(row.subject_kind)||!STATES.has(row.state)||
   !(row.created_at instanceof Date)||!Number.isFinite(row.created_at.getTime())||
   typeof row.resource_scope!=='string'||!allowedScopes.has(row.resource_scope))
   throw new UnauthorizedException('Authentication required');
  seen.add(row.id.toLowerCase());
  items.push({id:row.id,subjectKind:row.subject_kind as ModerationCaseSummary['subjectKind'],
   state:row.state as ModerationCaseSummary['state'],createdAt:row.created_at.toISOString()});
 }
 return items;
}

/**
 * Read-only, redacted, server-filtered queue. No client-selected scopes.
 * Every response row must have an exact active DB grant and current MFA.
 */
@Injectable()
export class PlatformModerationReadService{
 constructor(@Inject(DatabasePool) private readonly db:DatabasePool){}
 async list(authorization:unknown):Promise<{items:ModerationCaseSummary[]}>{
  if(process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP!=='enabled')
   throw new UnauthorizedException('Authentication required');
  const token=extractAdminBearerToken(authorization);
  if(token===null)throw new UnauthorizedException('Authentication required');
  let pepper:Buffer;
  try{pepper=requireSecret(process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY);}
  catch{throw new UnauthorizedException('Authentication required');}
  const now=Date.now();
  try{return await this.db.transaction(async client=>{
   const principal=await resolvePlatformAdminSession(client,token,pepper,now);
   if(!principal)throw new UnauthorizedException('Authentication required');
   // No discoverability for users with no moderation.read grant.
   const scopes=principal.resourceScopes.filter(scope=>
    canPerformAdminOperation(principal,'moderation.read',scope,now));
   if(scopes.length===0)return {items:[]};
   const result=await client.query<CaseRow>(`
     SELECT id::text,resource_scope,subject_kind,state,created_at
     FROM platform_moderation_cases AS moderation
     WHERE moderation.resource_scope=ANY($1::varchar[])
       AND EXISTS (
         SELECT 1
         FROM platform_admin_grants AS current_grant
         JOIN platform_admin_staff AS current_staff
           ON current_staff.id=current_grant.staff_id
         JOIN platform_admin_sessions AS current_session
           ON current_session.staff_id=current_staff.id
         JOIN users AS current_user
           ON current_user.id=current_staff.user_id
         WHERE current_staff.user_id=$2::uuid
           AND current_staff.disabled_at IS NULL
           AND current_staff.role IN ('owner','admin','operator','auditor')
           AND current_user.status='ACTIVE'
           AND current_session.token_hash=$3
           AND current_session.revoked_at IS NULL
           AND current_session.expires_at>to_timestamp($4::double precision/1000.0)
           AND current_session.mfa_verified_at<=to_timestamp($4::double precision/1000.0)
           AND current_session.mfa_verified_at>=to_timestamp(($4::double precision-900000)/1000.0)
           AND current_grant.scope=moderation.resource_scope
       )
     ORDER BY moderation.created_at DESC,moderation.id DESC
     LIMIT 50
   `,[scopes,principal.userId,hashAdminSessionToken(token,pepper),now]);
   // Fail closed on malformed database-driver replies instead of leaking a TypeError.
   if(!result||!Array.isArray(result.rows))
    throw new UnauthorizedException('Authentication required');
   const items=validateModerationCaseRows(result.rows,new Set(scopes));
   return {items};
  });}catch(error){
   if(error instanceof UnauthorizedException)throw error;
   throw new UnauthorizedException('Authentication required');
  }
 }
}
