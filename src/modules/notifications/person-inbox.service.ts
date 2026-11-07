import {Injectable,UnauthorizedException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {resolveActiveUserSession} from '../identity/session-proof.js';
import {readPersonInAppInbox} from './in-app-materialization.js';

export type PersonNotificationItem=Readonly<{
 id:string;topic:string;subject_id:string;created_at:string;
}>;

/**
 * Resolves the recipient from a live, verified bearer in the SAME database
 * transaction as the inbox read. Never accepts a browser-selected person ID.
 */
@Injectable()
export class PersonInboxService {
 constructor(private readonly db:DatabasePool){}
 async list(token:string,limit:number):Promise<{items:PersonNotificationItem[]}>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)
   throw new RangeError('invalid_inbox_limit');
  const pepper=requireSecret(process.env.ACCOUNT_SESSION_HMAC_KEY);
  return this.db.transaction(async client=>{
   const actor=await resolveActiveUserSession(client,token,pepper);
   if(!actor)throw new UnauthorizedException('Authentication required');
   const people=await client.query<{id:string}>(`
     SELECT id::text FROM persons WHERE user_id=$1::uuid LIMIT 2
   `,[actor.userId]);
   // A missing or ambiguous person mapping must never widen the read scope.
   if(people.rows.length!==1) return {items:[]};
   const rows=await readPersonInAppInbox(client,people.rows[0].id,limit);
   return {items:rows.map(row=>({
    id:row.id,topic:row.topic,subject_id:row.subject_id,
    created_at:row.created_at.toISOString(),
   }))};
  });
 }
}
