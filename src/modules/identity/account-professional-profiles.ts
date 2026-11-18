import type {PoolClient} from 'pg';
import {readAccountMe} from './account-me.js';
import type {PublicOffer} from '../catalog/public-profile.repository.js';

type ProfileStatus='draft'|'published'|'paused'|'archived';
export type OwnProfessionalProfile={
 id:string;profession_id:string;lifecycle_status:ProfileStatus;slug:string;title:string|null;offers:PublicOffer[];version?:number;about?:string|null;
};
type ProfileRow=Omit<OwnProfessionalProfile,'offers'>;

/** Owner identity is resolved inside the same transaction as the read. */
export async function listOwnProfessionalProfiles(
 db:Pick<PoolClient,'query'>,token:unknown,pepper:Buffer,
):Promise<OwnProfessionalProfile[]|null>{
 const actor=await readAccountMe(db,token,pepper);
 if(!actor)return null;
 const profiles=await db.query<ProfileRow>(`
  SELECT id::text,profession_id::text,lower(status::text) AS lifecycle_status,slug,title,version,about
  FROM professional_profiles
  WHERE person_id=$1::uuid
  ORDER BY slug COLLATE "C",id
 `,[actor.person_id]);
 if(!profiles.rows.length)return [];
 const offers=await db.query<PublicOffer&{professional_id:string}>(`
  SELECT o.id::text,o.professional_id::text,o.title,o.delivery_mode,o.price_label
  FROM service_offers o
  JOIN professional_profiles p ON p.id=o.professional_id
  WHERE p.person_id=$1::uuid AND o.status='PUBLISHED'
    AND o.professional_id=ANY($2::uuid[])
  ORDER BY o.title COLLATE "C",o.id
 `,[actor.person_id,profiles.rows.map(p=>p.id)]);
 const grouped=new Map<string,PublicOffer[]>();
 for(const o of offers.rows){
  const group=grouped.get(o.professional_id)??[];
  group.push({id:o.id,title:o.title,delivery_mode:o.delivery_mode,price_label:o.price_label});
  grouped.set(o.professional_id,group);
 }
 return profiles.rows.map(p=>({id:p.id,profession_id:p.profession_id,lifecycle_status:p.lifecycle_status,slug:p.slug,title:p.title,version:p.version,about:p.about,offers:grouped.get(p.id)??[]}));
}
