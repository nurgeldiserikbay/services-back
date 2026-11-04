import {Injectable} from '@nestjs/common';
import {GuestChallengeVerificationService} from './guest-challenge-verification.service.js';
import {GuestRequestService} from './guest-request.service.js';
import type {CreatedGuestRequest} from './guest-request.transaction.js';

/**
 * Internal application use case: verifies the CREATE_REQUEST OTP and atomically
 * creates a service request using the scoped proof. It does not expose bearer
 * capabilities or guest PII via a controller. The caller must enforce network
 * throttling and authenticated, CSRF-protected browser session boundaries.
 *
 * A failed create may leave a verified CREATE_REQUEST capability unconsumed;
 * a future trusted BFF should persist that proof in its HttpOnly session and
 * retry create with the same idempotency key instead of repeating verification.
 */
@Injectable()
export class GuestVerifiedRequestFlow {
  constructor(
    private readonly verification:GuestChallengeVerificationService,
    private readonly requests:GuestRequestService,
  ){}

  async verifyAndCreate(
    challengeId:unknown,
    code:unknown,
    requestBody:unknown,
    idempotencyKey:unknown,
  ):Promise<CreatedGuestRequest>{
    const proof=await this.verification.verifyCreateRequest(challengeId,code);
    return this.requests.createFromVerifiedContact(
      requestBody,proof.guestCapability,idempotencyKey,
    );
  }
}
