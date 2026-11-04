import {Injectable} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {cancelVerifiedGuestRequest,type GuestCancellationResult,
  GuestCancellationRejected} from './guest-cancel.transaction.js';

/**
 * Internal only. No public controller until a CSRF/Origin-checked BFF
 * cancellation contract, expected-version/idempotency semantics and full
 * delivery/staging acceptance are approved.
 */
@Injectable()
export class GuestCancellationService{
  constructor(private readonly database:DatabasePool){}
  cancel(
    requestId:string,readCancelProof:string,expectedVersion:number,
  ):Promise<GuestCancellationResult>{
    let pepper:Buffer;
    try{pepper=requireSecret(process.env.GUEST_REQUEST_HMAC_KEY);}
    catch{throw new GuestCancellationRejected('unavailable');}
    return this.database.transaction(client=>cancelVerifiedGuestRequest(
      client,requestId,readCancelProof,expectedVersion,pepper,
    ));
  }
}
