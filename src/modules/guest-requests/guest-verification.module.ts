import {Module} from '@nestjs/common';
import {GuestChallengeProofRepository} from './guest-challenge-proof.repository.js';
import {GuestChallengeVerificationService} from './guest-challenge-verification.service.js';
import {GuestChallengeIssuanceService} from './guest-challenge-issuance.service.js';
import {GuestOtpDispatchService} from './guest-otp-dispatch.service.js';
import {OtpDeliveryService} from './otp-delivery.service.js';
import {GuestRequestService} from './guest-request.service.js';
import {GuestVerifiedRequestFlow} from './guest-verified-request.flow.js';

/** Intentionally no public HTTP controller until BFF and abuse controls are ready. */
@Module({
  providers:[
    GuestChallengeProofRepository,GuestChallengeVerificationService,
    GuestChallengeIssuanceService,GuestOtpDispatchService,
    GuestRequestService,GuestVerifiedRequestFlow,
    // No provider is configured until a reviewed KZ-resident adapter is wired.
    {provide:OtpDeliveryService,useFactory:()=>new OtpDeliveryService()},
  ],
  exports:[GuestChallengeVerificationService,GuestChallengeIssuanceService,GuestOtpDispatchService,GuestRequestService,GuestVerifiedRequestFlow],
})
export class GuestVerificationModule {}
