import {BadRequestException,ConflictException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {readAccountMe} from './account-me.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Db=Pick<PoolClient,'query'>;
type Row={id:string;version:number;title:string|null;about:string|null;status:'DRAFT'|'PUBLISHED'|'PAUSED'|'ARCHIVED';published_version:number|null};
export type PublishReceipt={id:string;version:number;published_version:number;lifecycle_status:'published'};
export function parsePublishRequest(id:unknown,match:unknown,body:unknown):{id:string;version:number}{
 if(typeof id!=='string'||!UUID.test(id)||typeof match!=='string'||!/^"[1-9][0-9]{0,9}"$/.test(match)||
  Number(match.slice(1,-1))>=2147483646||
  !body||typeof body!=='object'||Array.isArray(body)||Object.getPrototypeOf(body)!==Object.prototype||
  Reflect.ownKeys(body).length!==0)throw new BadRequestException('Invalid publish request');
 return {id:id.toLowerCase(),version:Number(match.slice(1,-1))};
}
/** Caller owns transaction. Serializes with owner edits and records one immutable published revision. */
export async function publishOwnProfessionalProfile(db:Db,token:unknown,pepper:Buffer,id:unknown,match:unknown,body:unknown):Promise<PublishReceipt>{
 const command=parsePublishRequest(id,match,body);
 const actor=await readAccountMe(db,token,pepper);
 if(!actor)throw new UnauthorizedException('Authentication required');
 const locked=await db.query<Row>(
  'SELECT id::text,version,title,about,status,published_version FROM professional_profiles WHERE id=$1::uuid AND person_id=$2::uuid FOR UPDATE',
  [command.id,actor.person_id]);
 const profile=locked.rows[0];
 if(!profile)throw new NotFoundException('Profile unavailable');
 if(profile.version!==command.version)throw new ConflictException('Profile version conflict');
 if(!['DRAFT','PUBLISHED'].includes(profile.status))throw new ConflictException('Profile cannot be published from current state');
 if(!profile.title||profile.title.trim().length<3||!profile.about||profile.about.trim().length<20)
  throw new ConflictException('Profile is incomplete');
 if(profile.status==='PUBLISHED'&&profile.published_version===profile.version)
  throw new ConflictException('No unpublished changes');
 const offers=await db.query<{present:boolean}>(
  "SELECT EXISTS(SELECT 1 FROM service_offers WHERE professional_id=$1::uuid AND status='PUBLISHED') AS present",
  [command.id]);
 if(offers.rows[0]?.present!==true)throw new ConflictException('Published service offer required');
 // Conservative release guard: open moderation cases must block publication.
 // A closed case alone does NOT certify an explicit approval; activation remains gated.
 const moderation=await db.query<{blocked:boolean}>(`
  SELECT EXISTS(
   SELECT 1 FROM platform_moderation_cases
   WHERE resource_scope=$1 AND subject_kind='professional' AND state<>'closed'
  ) AS blocked`,['professional:'+command.id]);
 if(moderation.rows[0]?.blocked!==false)
  throw new ConflictException('Profile has unresolved moderation');
 // Publication needs a POSITIVE, version-specific decision. A closed case
 // alone is never approval. Reject mixed APPROVE/REJECT evidence for the same
 // version; decisions for older drafts cannot authorize an edited draft.
 // The professional profile is locked FOR UPDATE above, serializing with the
 // moderator's FOR SHARE profile lock while a decision is committed.
 const approval=await db.query<{approved:boolean;rejected:boolean}>(`
  SELECT
   EXISTS(
    SELECT 1 FROM professional_moderation_decisions AS decision
    JOIN platform_moderation_cases AS moderation_case ON moderation_case.id=decision.case_id
    WHERE decision.profile_id=$1::uuid AND decision.profile_version=$2
      AND decision.decision='APPROVE'
      AND moderation_case.subject_kind='professional'
      AND moderation_case.resource_scope=$3
      AND moderation_case.state='closed'
   ) AS approved,
   EXISTS(
    SELECT 1 FROM professional_moderation_decisions AS decision
    JOIN platform_moderation_cases AS moderation_case ON moderation_case.id=decision.case_id
    WHERE decision.profile_id=$1::uuid AND decision.profile_version=$2
      AND decision.decision='REJECT'
      AND moderation_case.subject_kind='professional'
      AND moderation_case.resource_scope=$3
      AND moderation_case.state='closed'
   ) AS rejected
 `,[command.id,command.version,'professional:'+command.id]);
 if(approval.rows.length!==1||approval.rows[0]?.approved!==true||
    approval.rows[0]?.rejected!==false)
  throw new ConflictException('Profile requires an explicit current moderation approval');
 // Guard existing incomplete requests; concurrent request creation still needs
 // a reviewed common locking protocol before this endpoint can be enabled.
 const activity=await db.query<{blocked:boolean}>(`
  SELECT EXISTS(
   SELECT 1 FROM service_requests
   WHERE (seller_professional_id=$1::uuid OR performer_professional_id=$1::uuid)
     AND status IN ('PENDING','ACCEPTED')
  ) AS blocked`,[command.id]);
 if(activity.rows[0]?.blocked!==false)
  throw new ConflictException('Profile has active requests');
 // Assignments can exist before a customer request is created. A PROPOSED or
 // ACCEPTED assignment is still an unresolved operational obligation.
 const assignments=await db.query<{blocked:boolean}>(`
  SELECT EXISTS(
   SELECT 1 FROM service_assignments
   WHERE professional_id=$1::uuid AND status IN ('PROPOSED','ACCEPTED')
  ) AS blocked`,[command.id]);
 if(assignments.rows[0]?.blocked!==false)
  throw new ConflictException('Profile has active assignments');
 // This explicit approval does not override unresolved seller eligibility,
 // appeal policy, assignment rules or broader cross-command release gates.
 // Keep the endpoint disabled until independent activation review.
 const updated=await db.query<{id:string;version:number;published_version:number}>(
  "UPDATE professional_profiles SET status='PUBLISHED',version=version+1,published_title=title,published_about=about,published_version=version+1 WHERE id=$1::uuid AND person_id=$2::uuid AND version=$3 AND status IN ('DRAFT','PUBLISHED') RETURNING id::text,version,published_version",
  [command.id,actor.person_id,command.version]);
 if(updated.rows.length!==1||!updated.rows[0])throw new ConflictException('Profile version conflict');
 const row=updated.rows[0];
 // DB revision trigger checks insert/collision/immutability in this transaction.
 await db.query(
  "INSERT INTO professional_publication_audit(profile_id,actor_person_id,from_status,from_version,to_version) VALUES($1::uuid,$2::uuid,$3,$4,$5)",
  [command.id,actor.person_id,profile.status,command.version,row.published_version]);
 return {id:row.id,lifecycle_status:'published',version:row.version,published_version:row.published_version};
}
