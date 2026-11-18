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
 // This deliberately does not override moderation, bookings or seller eligibility.
 // Endpoint stays disabled until activation prerequisites are independently approved.
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
