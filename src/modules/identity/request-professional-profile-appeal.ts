import {BadRequestException,ConflictException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {readAccountMe} from './account-me.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Db=Pick<PoolClient,'query'>;
type Command={id:string;version:number;decisionId:string};
export type AppealReceipt={case_id:string;profile_id:string;profile_version:number;state:'appeal'};

/** Strict, duplicate-safe intake: no free text or sensitive appeal content. */
export function parseProfileAppeal(id:unknown,match:unknown,body:unknown):Command{
 if(typeof id!=='string'||!UUID.test(id)||typeof match!=='string'||
    !/^"[1-9][0-9]{0,9}"$/.test(match)||
    Number(match.slice(1,-1))>2147483646||!body||typeof body!=='object'||
    Array.isArray(body)||Object.getPrototypeOf(body)!==Object.prototype||
    Object.keys(body).length!==1||!Object.hasOwn(body,'decision_id'))
  throw new BadRequestException('Invalid appeal request');
 const decisionId=(body as {decision_id?:unknown}).decision_id;
 if(typeof decisionId!=='string'||!UUID.test(decisionId))
  throw new BadRequestException('Invalid appeal request');
 return {id:id.toLowerCase(),version:Number(match.slice(1,-1)),decisionId:decisionId.toLowerCase()};
}
/** Caller controls the DB transaction. Original REJECT evidence stays intact. */
export async function requestOwnProfileAppeal(
 db:Db,token:unknown,pepper:Buffer,id:unknown,match:unknown,body:unknown,
):Promise<AppealReceipt>{
 const cmd=parseProfileAppeal(id,match,body);
 const actor=await readAccountMe(db,token,pepper);
 if(!actor)throw new UnauthorizedException('Authentication required');
 const profile=await db.query<{version:number}>(
  'SELECT version FROM professional_profiles WHERE id=$1::uuid AND person_id=$2::uuid FOR SHARE',
  [cmd.id,actor.person_id]);
 if(profile.rows.length!==1||!profile.rows[0])throw new NotFoundException('Profile unavailable');
 if(profile.rows[0].version!==cmd.version)throw new ConflictException('Profile revision conflict');
 // Locks the original decision row and verifies the matching professional case.
 const decision=await db.query<{id:string}>(`
  SELECT d.id::text
  FROM professional_moderation_decisions AS d
  JOIN platform_moderation_cases AS source_case ON source_case.id=d.case_id
  WHERE d.id=$1::uuid AND d.profile_id=$2::uuid AND d.profile_version=$3
    AND d.decision='REJECT' AND source_case.state='closed'
    AND source_case.subject_kind='professional' AND source_case.resource_scope=$4
  FOR SHARE OF d,source_case`,
  [cmd.decisionId,cmd.id,cmd.version,'professional:'+cmd.id]);
 if(decision.rows.length!==1)throw new ConflictException('Rejection evidence unavailable');
 // Unique original_decision_id is the idempotency boundary. Replaying the same
 // rejection cannot create another case; this also denies duplicate open appeals.
 const existing=await db.query<{case_id:string}>(`
  SELECT case_id::text FROM professional_moderation_appeals
  WHERE original_decision_id=$1::uuid AND profile_id=$2::uuid
    AND submitted_by_person_id=$3::uuid AND profile_version=$4
 `,[cmd.decisionId,cmd.id,actor.person_id,cmd.version]);
 if(existing.rows.length===1&&existing.rows[0])
  return {case_id:existing.rows[0].case_id,profile_id:cmd.id,profile_version:cmd.version,state:'appeal'};
 if(existing.rows.length!==0)throw new ConflictException('Appeal unavailable');
 // Only one unresolved professional moderation case can be open. This
 // prevents appeals silently bypassing other active review/hold records.
 const open=await db.query<{blocked:boolean}>(`
  SELECT EXISTS(SELECT 1 FROM platform_moderation_cases
   WHERE resource_scope=$1 AND subject_kind='professional' AND state<>'closed') AS blocked
 `,['professional:'+cmd.id]);
 if(open.rows.length!==1||open.rows[0]?.blocked!==false)
  throw new ConflictException('Professional already has open moderation');
 const caseId=randomUUID(),appealId=randomUUID();
 await db.query("INSERT INTO platform_moderation_cases(id,resource_scope,subject_kind,state) VALUES($1::uuid,$2,'professional','appeal')",
  [caseId,'professional:'+cmd.id]);
 await db.query(`
  INSERT INTO professional_moderation_appeals(
   id,original_decision_id,case_id,profile_id,profile_version,submitted_by_person_id
  ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid)
 `,[appealId,cmd.decisionId,caseId,cmd.id,cmd.version,actor.person_id]);
 return {case_id:caseId,profile_id:cmd.id,profile_version:cmd.version,state:'appeal'};
}
