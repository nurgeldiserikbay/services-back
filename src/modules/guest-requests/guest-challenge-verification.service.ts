import {Injectable,ServiceUnavailableException,UnauthorizedException} from '@nestjs/common';
import {GuestChallengeProofRepository} from './guest-challenge-proof.repository.js';
import {requireSecret} from './guest-request.security.js';

/** Internal only. Never expose a raw capability in browser JavaScript. */
@Injectable()
export class GuestChallengeVerificationService {
  constructor(private readonly proofs:GuestChallengeProofRepository){}

  async verifyCreateRequest(challengeId:unknown,code:unknown):
    Promise<{guestCapability:string;expiresInSeconds:number}> {
    if(typeof challengeId!=='string'||typeof code!=='string'||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challengeId)||
      !/^[0-9]{6}$/.test(code))
      throw new UnauthorizedException('Invalid or expired verification code');

    let pepper:Buffer;
    try {
      pepper=requireSecret(process.env.GUEST_REQUEST_HMAC_KEY);
    }catch{
      throw new ServiceUnavailableException('Verification temporarily unavailable');
    }
    const result=await this.proofs.verifyCreateRequest(challengeId,code,pepper);
    if(!result)throw new UnauthorizedException('Invalid or expired verification code');
    return result;
  }
}
