import {BadRequestException,ConflictException,ForbiddenException,UnauthorizedException} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {readAccountMe} from './account-me.js';
import type {OwnProfessionalProfile} from './account-professional-profiles.js';
import type {PublicOffer} from '../catalog/public-profile.repository.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Command={id:string;version:number;title?:string;about?:string};
export function parseUpdateProfile(id:unknown,match:unknown,body:unknown):Command{
 const bad=()=>new BadRequestException('Invalid profile update');
 if(typeof id!=='string'||!UUID.test(id)||typeof match!=='string'||!/^"[1-9][0-9]{0,9}"$/.test(match)||
    !body||typeof body!=='object'||Array.isArray(body)||Object.getPrototypeOf(body)!==Object.prototype)throw bad();
 const version=Number(match.slice(1,-1));
 if(version>=2147483647)throw bad();
 const fields=Object.getOwnPropertyDescriptors(body);
 const keys=Reflect.ownKeys(body);
 if(!keys.length||keys.some(k=>typeof k!=='string'||!['title','about'].includes(k)))throw bad();
 const command:Command={id:id.toLowerCase(),version};
 for(const key of ['title','about'] as const){
  const descriptor=fields[key];
  if(!descriptor)continue;
  if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='string'||
     descriptor.value.includes('\0')||Array.from(descriptor.value).length>(key==='title'?180:3000))throw bad();
  command[key]=descriptor.value;
 }
 return command;
}
type Db=Pick<PoolClient,'query'>;
type Row=Omit<OwnProfessionalProfile,'offers'>;
export async function updateOwnProfessionalProfile(db:Db,token:unknown,pepper:Buffer,id:unknown,match:unknown,body:unknown):Promise<OwnProfessionalProfile>{
 const cmd=parseUpdateProfile(id,match,body);
 const actor=await readAccountMe(db,token,pepper);
 if(!actor)throw new UnauthorizedException('Authentication required');
 const locked=await db.query<{version:number}>(
  'SELECT version FROM professional_profiles WHERE id=$1::uuid AND person_id=$2::uuid FOR UPDATE',
  [cmd.id,actor.person_id]);
 if(!locked.rows[0])throw new ForbiddenException('Profile unavailable');
 if(locked.rows[0].version!==cmd.version)throw new ConflictException('Profile version conflict');
 const updated=await db.query<Row>(
  "UPDATE professional_profiles SET title=CASE WHEN $4::boolean THEN $5::text ELSE title END,about=CASE WHEN $6::boolean THEN $7::text ELSE about END,version=version+1 WHERE id=$1::uuid AND person_id=$2::uuid AND version=$3 RETURNING id::text,profession_id::text,lower(status::text) AS lifecycle_status,slug,title,about,version",
  [cmd.id,actor.person_id,cmd.version,cmd.title!==undefined,cmd.title??null,cmd.about!==undefined,cmd.about??null]);
 const row=updated.rows[0];
 if(!row)throw new ConflictException('Profile version conflict');
 const offers=await db.query<PublicOffer>(
  "SELECT o.id::text,o.title,o.delivery_mode,o.price_label FROM service_offers o JOIN professional_profiles p ON p.id=o.professional_id WHERE p.person_id=$1::uuid AND p.id=$2::uuid AND o.status='PUBLISHED' ORDER BY o.title COLLATE \"C\",o.id",
  [actor.person_id,cmd.id]);
 return {id:row.id,profession_id:row.profession_id,lifecycle_status:row.lifecycle_status,slug:row.slug,title:row.title,about:row.about,version:row.version,offers:offers.rows.map(o=>({id:o.id,title:o.title,delivery_mode:o.delivery_mode,price_label:o.price_label}))};
}
