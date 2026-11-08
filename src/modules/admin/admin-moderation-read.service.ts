import {Injectable,UnauthorizedException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {resolvePlatformAdminSession} from './admin-session-resolver.js';
import {canPerformAdminOperation} from './admin-authorization.policy.js';

const TOKEN=/^Bearer ([A-Za-z0-9_-]{42}[AQgw])$/;
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
 if(rows.length>50)throw new UnauthorizedException('Authentication required');
 const seen=new Set<string>();
 const items:ModerationCaseSummary[]=[];
 for(const row of rows){
  if(typeof row.id!=='string'||!UUID.test(row.id)||seen.has(row.id.toLowerCase())||
   !KINDS.has(row.subject_kind)||!STATES.has(row.state)||
   !(row.created_at instanceof Date)||!Number.isFinite(row.created_at.getTime())||
   !allowedScopes.has(row.resource_scope))
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
 constructor(private readonly db:DatabasePool){}
 async list(authorization:unknown):Promise<{items:ModerationCaseSummary[]}>{
  if(process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP!=='enabled')
   throw new UnauthorizedException('Authentication required');
  const match=typeof authorization==='string'?TOKEN.exec(authorization):null;
  if(!match)throw new UnauthorizedException('Authentication required');
  const pepper=requireSecret(process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY);
  const now=Date.now();
  return this.db.transaction(async client=>{
   const principal=await resolvePlatformAdminSession(client,match[1],pepper,now);
   if(!principal)throw new UnauthorizedException('Authentication required');
   // No discoverability for users with no moderation.read grant.
   const scopes=principal.resourceScopes.filter(scope=>
    canPerformAdminOperation(principal,'moderation.read',scope,now));
   if(scopes.length===0)return {items:[]};
   const result=await client.query<CaseRow>(`
     SELECT id::text,resource_scope,subject_kind,state,created_at
     FROM platform_moderation_cases
     WHERE resource_scope=ANY($1::varchar[])
     ORDER BY created_at DESC,id DESC
     LIMIT 50
   `,[scopes]);
   const items=validateModerationCaseRows(result.rows,new Set(scopes));
   return {items};
  });
 }
}
