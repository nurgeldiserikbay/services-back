import {BadRequestException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {readAccountMe} from './account-me.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Row={id:string;slug:string;profession_id:string;lifecycle_status:'draft'|'published'|'paused'|'archived';title:string|null;about:string|null;version:number;published_title:string|null;published_about:string|null;published_version:number|null};
export type ProfilePreview={id:string;slug:string;profession_id:string;lifecycle_status:Row['lifecycle_status'];draft:{title:string|null;about:string|null;version:number};published:{title:string|null;about:string|null;version:number}|null};
/** Owner-only draft and published projection. Caller owns the DB transaction. */
export async function readProfilePreview(db:Pick<PoolClient,'query'>,token:unknown,pepper:Buffer,id:unknown):Promise<ProfilePreview>{
 if(typeof id!=='string'||!UUID.test(id))throw new BadRequestException('Invalid profile ID');
 const owner=await readAccountMe(db,token,pepper);
 if(!owner)throw new UnauthorizedException('Authentication required');
 const result=await db.query<Row>(`
  SELECT id::text,slug,profession_id::text,lower(status::text) AS lifecycle_status,
   title,about,version,published_title,published_about,published_version
  FROM professional_profiles WHERE id=$1::uuid AND person_id=$2::uuid FOR SHARE
 `,[id.toLowerCase(),owner.person_id]);
 const row=result.rows[0];
 if(result.rows.length!==1||!row)throw new NotFoundException('Profile unavailable');
 return {id:row.id,slug:row.slug,profession_id:row.profession_id,lifecycle_status:row.lifecycle_status,
  draft:{title:row.title,about:row.about,version:row.version},
  published:row.published_version===null?null:{title:row.published_title,about:row.published_about,version:row.published_version}};
}
