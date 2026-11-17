import {Injectable} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {cancelVerifiedGuestRequest,type GuestCancellationResult,
  GuestCancellationRejected} from './guest-cancel.transaction.js';
import {cancelGuestRequestIdempotently}
  from './guest-cancel-idempotency.transaction.js';
import {parseCancellationPreflight}
  from './cancellation-command-contract.js';

/**
 * Internal only. No public controller until a CSRF/Origin-checked BFF
 * cancellation contract, expected-version/idempotency semantics and full
 * delivery/staging acceptance are approved.
 */
@Injectable()
export class GuestCancellationService{
  constructor(private readonly database:DatabasePool){}
  /**
   * Internal transaction-scoped entry point for a future authenticated BFF.
   * The ledger key MUST be an independent 256-bit secret. No HTTP route
   * is exposed by this service; authorization/CSRF belong to its caller.
   */
  /**
   * Unmounted future BFF boundary: the caller MUST supply a trusted,
   * server-verified session CSRF and deployment origin/protocol context.
   * readCancelProof must come from a sealed, request-scoped server secret;
   * never accept it from a request JSON body. No HTTP controller is exposed.
   */
  cancelWithPreflight(
    transport:Parameters<typeof parseCancellationPreflight>[0],
    readCancelProof:string,
  ):Promise<GuestCancellationResult>{
    const command=parseCancellationPreflight(transport);
    return this.cancelIdempotently(command.requestId,readCancelProof,
      command.expectedVersion,command.idempotencyKey);
  }

  cancelIdempotently(
    requestId:string,readCancelProof:string,expectedVersion:number,
    idempotencyKey:string,
  ):Promise<GuestCancellationResult>{
    let pepper:Buffer,ledgerSecret:Buffer;
    try{
      pepper=requireSecret(process.env.GUEST_REQUEST_HMAC_KEY);
      ledgerSecret=requireSecret(process.env.GUEST_CANCEL_LEDGER_HMAC_KEY);
      if(pepper.equals(ledgerSecret))
        throw new Error('ledger_key_must_be_distinct');
    }catch{
      throw new GuestCancellationRejected('unavailable');
    }
    return this.database.transaction(client=>cancelGuestRequestIdempotently(
      client,requestId,readCancelProof,expectedVersion,idempotencyKey,
      pepper,ledgerSecret,
    ));
  }

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
