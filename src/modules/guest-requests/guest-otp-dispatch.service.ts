import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {GuestChallengeIssuanceService} from './guest-challenge-issuance.service.js';
import {OtpDeliveryService} from './otp-delivery.service.js';

/**
 * Internal dispatch boundary. The plaintext OTP and contact never leave this
 * method except to the approved delivery adapter. Do not expose as HTTP
 * until network/global rate limiting and secure BFF are integrated.
 */
@Injectable()
export class GuestOtpDispatchService {
  constructor(
    private readonly issuance:GuestChallengeIssuanceService,
    private readonly delivery:OtpDeliveryService,
    private readonly db:DatabasePool,
  ) {}

  async dispatchCreateRequest(
    channel:'email'|'sms', contact:unknown, locale:'kk'|'ru',networkDigest?:string,
  ):Promise<{challengeId:string;expiresInSeconds:number}> {
    if(locale!=='kk' && locale!=='ru')
      throw new ServiceUnavailableException('OTP temporarily unavailable');

    const challenge=await this.issuance.issueCreateRequest(channel,contact,networkDigest);
    try {
      const receipt=await this.delivery.deliverCommittedChallenge({
        channel:challenge.channel,contact:challenge.contact,
        code:challenge.code,locale,
        expiresInSeconds:challenge.expiresInSeconds,
      });
      if(!receipt.accepted)
        throw new ServiceUnavailableException('OTP temporarily unavailable');
    } catch {
      // Challenge creation must stay charged against recipient quota, even if
      // provider delivery fails. Revoke it to prevent uncertain late delivery
      // from producing a usable proof. Never log sensitive provider details.
      try {
        await this.db.query(
          `UPDATE guest_challenges SET consumed_at=now()
           WHERE id=$1::uuid AND purpose='CREATE_REQUEST'
             AND consumed_at IS NULL`,
          [challenge.challengeId],
        );
      } catch {
        // No second exception exposing DB/provider internals. A DB outage may
        // postpone revocation; challenge still expires and attempt limits apply.
      }
      throw new ServiceUnavailableException('OTP temporarily unavailable');
    }
    return {
      challengeId:challenge.challengeId,
      expiresInSeconds:challenge.expiresInSeconds,
    };
  }
}
