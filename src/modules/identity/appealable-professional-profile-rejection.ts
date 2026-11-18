import {BadRequestException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {readAccountMe} from './account-me.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Db=Pick<PoolClient,'query'>;
export type AppealableProfileDecision=Readonly<{
 profile_id:string;profile_version:number;decision_id:string;
}>;

/** Minimal owner-only lookup: never expose rejected cases or moderator IDs. */
export async function findOwnAppealableProfileRejection(
 db:Db,token:unknown,pepper:Buffer,id:unknown,
):Promise<AppealableProfileDecision|null>{
 if(typeof id!=='string'||!UUID.test(id))throw new BadRequestException('Invalid professional profile');
 const profileId=id.toLowerCase();
 const actor=await readAccountMe(db,token,pepper);
 if(!actor)throw new UnauthorizedException('Authentication required');
 const row=await db.query<{version:number}>(
  'SELECT version FROM professional_profiles WHERE id=$1::uuid AND person_id=$2::uuid FOR SHARE',
  [profileId,actor.person_id]);
 if(row.rows.length!==1||!row.rows[0])throw new NotFoundException('Profile unavailable');
 const version=row.rows[0].version;
 if(!Number.isSafeInteger(version)||version<1||version>2147483646)
  throw new NotFoundException('Profile unavailable');
 const decisions=await db.query<{decision_id:string}>(`
  SELECT decision.id::text AS decision_id
  FROM professional_moderation_decisions AS decision
  JOIN platform_moderation_cases AS moderation_case
    ON moderation_case.id=decision.case_id
  WHERE decision.profile_id=$1::uuid
    AND decision.profile_version=$2
    AND decision.decision='REJECT'
    AND moderation_case.subject_kind='professional'
    AND moderation_case.resource_scope=$3
    AND moderation_case.state='closed'
    AND NOT EXISTS (
     SELECT 1 FROM professional_moderation_appeals AS appeal
     WHERE appeal.original_decision_id=decision.id
    )
    AND NOT EXISTS (
     SELECT 1 FROM platform_moderation_cases AS open_case
     WHERE open_case.resource_scope=$3
       AND open_case.subject_kind='professional'
       AND open_case.state<>'closed'
    )
  ORDER BY decision.decided_at DESC,decision.id DESC LIMIT 1
 `,[profileId,version,'professional:'+profileId]);
 if(!Array.isArray(decisions.rows)||decisions.rows.length>1)
  throw new NotFoundException('Profile unavailable');
 const chosen=decisions.rows[0];
 if(!chosen)return null;
 if(typeof chosen.decision_id!=='string'||!UUID.test(chosen.decision_id))
  throw new NotFoundException('Profile unavailable');
 return {profile_id:profileId,profile_version:version,decision_id:chosen.decision_id};
}
