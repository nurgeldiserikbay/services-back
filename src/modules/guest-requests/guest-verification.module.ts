import {Module} from '@nestjs/common';
import {GuestChallengeProofRepository} from './guest-challenge-proof.repository.js';
import {GuestChallengeVerificationService} from './guest-challenge-verification.service.js';

/** Intentionally no public HTTP controller until BFF and abuse controls are ready. */
@Module({
  providers:[GuestChallengeProofRepository,GuestChallengeVerificationService],
  exports:[GuestChallengeVerificationService],
})
export class GuestVerificationModule {}
