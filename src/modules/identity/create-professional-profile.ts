import {BadRequestException,ConflictException,UnauthorizedException} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {readAccountMe} from './account-me.js';
import type {OwnProfessionalProfile} from './account-professional-profiles.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG=/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const ROUTE='/v1/me/professional-profiles';
type Command={professionId:string;preferredSlug:string|null;key:string};
export function parseCreateProfile(body:unknown,key:unknown):Command{
 if(typeof key!=='string'||!/^[\x21-\x7e]{8,128}$/.test(key)||!body||typeof body!=='object'||Array.isArray(body)||Object.getPrototypeOf(body)!==Object.prototype)
  throw new BadRequestException('Invalid profile creation');
 const fields=Object.getOwnPropertyDescriptors(body);
 if(Reflect.ownKeys(body).some(k=>typeof k!=='string'||!['profession_id','preferred_slug'].includes(k))||
    Object.values(fields).some(d=>!d.enumerable||!Object.hasOwn(d,'value')))
  throw new BadRequestException('Invalid profile creation');
 const professionId=fields.profession_id?.value;
 const slug=fields.preferred_slug?.value;
 if(typeof professionId!=='string'||!UUID.test(professionId)||
    (fields.preferred_slug!==undefined&&(typeof slug!=='string'||!SLUG.test(slug))))
  throw new BadRequestException('Invalid profile creation');
 return {professionId:professionId.toLowerCase(),preferredSlug:slug??null,key};
}
type Db=Pick<PoolClient,'query'>;
type Row=Omit<OwnProfessionalProfile,'offers'>;
const conflict=()=>new ConflictException('Profile creation conflict');

/** Caller owns the transaction. Ledger and draft profile commit atomically. */
export async function createOwnProfessionalProfile(db:Db,token:unknown,pepper:Buffer,body:unknown,key:unknown):Promise<OwnProfessionalProfile>{
 const command=parseCreateProfile(body,key);
 const actor=await readAccountMe(db,token,pepper);
 if(!actor)throw new UnauthorizedException('Authentication required');
 const actorScope='profile-create:'+actor.person_id;
 const keyHash=createHash('sha256').update(command.key).digest('hex');
 const requestHash=createHash('sha256').update(JSON.stringify([command.professionId,command.preferredSlug])).digest('hex');
 const ledger=await db.query<{id:string}>(
  "INSERT INTO idempotency_records(id,actor_scope,method,route,key,request_hash,state,expires_at) VALUES($1,$2,'POST',$3,$4,$5,'PROCESSING',clock_timestamp()+interval '1 day') ON CONFLICT(actor_scope,method,route,key) DO NOTHING RETURNING id::text",
  [randomUUID(),actorScope,ROUTE,keyHash,requestHash]);
 if(!ledger.rows[0]){
  const prior=await db.query<{request_hash:string;state:string;response_status:number;response_body:unknown;live:boolean}>(
   "SELECT request_hash,state,response_status,response_body,expires_at>clock_timestamp() AS live FROM idempotency_records WHERE actor_scope=$1 AND method='POST' AND route=$2 AND key=$3 FOR UPDATE",
   [actorScope,ROUTE,keyHash]);
  const row=prior.rows[0];
  if(!row||!row.live||row.request_hash!==requestHash||row.state!=='COMPLETED'||row.response_status!==201)throw conflict();
  const saved=row.response_body as Record<string,unknown>|null;
  if(!saved||Object.keys(saved).sort().join(',')!=='id,lifecycle_status,offers,profession_id,slug,title'||
     typeof saved.id!=='string'||!UUID.test(saved.id)||saved.profession_id!==command.professionId||
     saved.lifecycle_status!=='draft'||saved.title!==null||!Array.isArray(saved.offers)||saved.offers.length!==0||
     typeof saved.slug!=='string'||!SLUG.test(saved.slug)||
     (command.preferredSlug!==null&&saved.slug!==command.preferredSlug))throw conflict();
  const current=await db.query<Row>(
   "SELECT id::text,profession_id::text,lower(status::text) AS lifecycle_status,slug,title FROM professional_profiles WHERE id=$1::uuid AND person_id=$2::uuid AND profession_id=$3::uuid FOR SHARE",
   [saved.id,actor.person_id,command.professionId]);
  const profile=current.rows[0];
  if(!profile||profile.lifecycle_status!=='draft'||profile.slug!==saved.slug||profile.title!==null)throw conflict();
  return {id:profile.id,profession_id:profile.profession_id,lifecycle_status:'draft',slug:profile.slug,title:null,offers:[]};
 }
 const id=randomUUID();
 const slug=command.preferredSlug??('pro-'+id);
 const result=await db.query<Row>(
  "INSERT INTO professional_profiles(id,person_id,profession_id,slug,status) SELECT $1::uuid,$2::uuid,p.id,$4,'DRAFT' FROM professions p WHERE p.id=$3::uuid ON CONFLICT DO NOTHING RETURNING id::text,profession_id::text,lower(status::text) AS lifecycle_status,slug,title",
  [id,actor.person_id,command.professionId,slug]);
 const row=result.rows[0];
 if(!row)throw conflict();
 const response:OwnProfessionalProfile={id:row.id,profession_id:row.profession_id,lifecycle_status:'draft',slug:row.slug,title:row.title,offers:[]};
 const completed=await db.query<{id:string}>(
  "UPDATE idempotency_records SET state='COMPLETED',response_status=201,response_body=$2::jsonb WHERE id=$1::uuid AND state='PROCESSING' RETURNING id::text",
  [ledger.rows[0].id,JSON.stringify(response)]);
 if(completed.rows.length!==1)throw conflict();
 return response;
}
