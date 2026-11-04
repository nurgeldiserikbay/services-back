import {ForbiddenException,Injectable} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {hashGuestCapability,requireSecret} from './guest-request.security.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY=/^[A-Za-z0-9_-]{43}$/;

type RequestRow={
  id:string;offer_id:string;status:string;version:number;created_at:Date;
};
export type GuestRequestStatus=Readonly<{
  id:string;service_offer_id:string;state:string;version:number;created_at:string;
}>;

/**
 * Internal-only capability-scoped read. No public HTTP controller is mounted
 * until verified BFF + provider + global/network abuse gates pass.
 *
 * A caller cannot enumerate request UUIDs: every lookup must match the given
 * READ_CANCEL proof AND the same guest_contact_id held by the request.
 */
@Injectable()
export class GuestRequestStatusService{
  constructor(private readonly db:DatabasePool){}

  async getOwnStatus(requestId:unknown,token:unknown):Promise<GuestRequestStatus>{
    if(typeof requestId!=='string'||!UUID.test(requestId)||
      typeof token!=='string'||!CAPABILITY.test(token))
      throw new ForbiddenException('Guest request unavailable');
    let pepper:Buffer;
    try{pepper=requireSecret(process.env.GUEST_REQUEST_HMAC_KEY);}
    catch{throw new ForbiddenException('Guest request unavailable');}
    const hash=hashGuestCapability('READ_CANCEL',token,pepper);
    const result=await this.db.query<RequestRow>(`
      SELECT r.id::text,r.offer_id::text,r.status::text,
             r.version,r.created_at
      FROM service_requests r
      JOIN guest_capabilities cap
        ON cap.request_id=r.id
       AND cap.guest_contact_id=r.guest_contact_id
       AND cap.scope='READ_CANCEL'
      WHERE r.id=$1::uuid
        AND cap.token_hash=$2
        AND cap.consumed_at IS NULL
        AND cap.expires_at>now()
        AND r.guest_contact_id IS NOT NULL
      LIMIT 1
    `,[requestId.toLowerCase(),hash]);
    const row=result.rows[0];
    if(!row)throw new ForbiddenException('Guest request unavailable');
    // Explicit safe DTO allowlist. Never include guest_contact_id, note,
    // scheduled private detail, seller's internal person ID or capability.
    return {
      id:row.id,service_offer_id:row.offer_id,
      state:row.status.toLowerCase(),version:row.version,
      created_at:row.created_at.toISOString(),
    };
  }
}
