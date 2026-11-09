import {
  Body,Controller,Headers,HttpCode,Header,NotFoundException,Param,Post,
  UnauthorizedException,
} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {GuestOtpDispatchService} from './guest-otp-dispatch.service.js';
import {GuestChallengeVerificationService} from './guest-challenge-verification.service.js';
import {verifyTrustedNetworkProof} from './guest-network-quota.js';
import {requireSecret} from './guest-request.security.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Guest schedule OTP routes are disabled unless trusted ingress and the
 * reviewed delivery adapter are configured. Tokens are consumed by the BFF. */
@Controller('guest-requests/:requestId/schedule-access/challenges')
export class GuestScheduleAccessHttpController{
  constructor(private readonly dispatch:GuestOtpDispatchService,
    private readonly verification:GuestChallengeVerificationService){}

  @Post()
  @HttpCode(202)
  @Header('Cache-Control','private, no-store, max-age=0')
  @Header('Pragma','no-cache')
  @Header('X-Robots-Tag','noindex, nofollow')
  async requestCode(
    @Param('requestId') requestId:unknown,
    @Headers('guest-capability') readCapability:unknown,
    @Headers('x-services-network-proof') networkProof:unknown,
    @Body() body:unknown,
  ):Promise<{challenge_id:string}>{
    this.requireEnabled();
    if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).length!==1||(body as Record<string,unknown>).locale!=='kk'&&
      (body as Record<string,unknown>).locale!=='ru'){
      return {challenge_id:randomUUID()};
    }
    let digest:string|null=null;
    try{digest=verifyTrustedNetworkProof(networkProof,
      requireSecret(process.env.GUEST_NETWORK_ATTESTATION_KEY));}catch{/* fail closed */}
    if(!digest)return {challenge_id:randomUUID()};
    const result=await this.dispatch.dispatchManageSchedule(
      requestId,readCapability,(body as {locale:'kk'|'ru'}).locale,digest,
    );
    // Same shape and status for unknown request IDs and invalid READ_CANCEL proof.
    return {challenge_id:result?.challengeId??randomUUID()};
  }

  @Post(':challengeId/verify')
  @HttpCode(200)
  @Header('Cache-Control','private, no-store, max-age=0')
  @Header('Pragma','no-cache')
  @Header('X-Robots-Tag','noindex, nofollow')
  async verifyCode(
    @Param('requestId') requestId:unknown,
    @Param('challengeId') challengeId:unknown,
    @Body() body:unknown,
  ):Promise<{guest_capability:string;expires_at:string}>{
    this.requireEnabled();
    if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).length!==1||typeof (body as Record<string,unknown>).code!=='string')
      throw new UnauthorizedException('Invalid or expired verification code');
    const proof=await this.verification.verifyManageSchedule(
      requestId,challengeId,(body as {code:string}).code,
    );
    return {guest_capability:proof.guestCapability,
      expires_at:new Date(Date.now()+proof.expiresInSeconds*1000).toISOString()};
  }

  private requireEnabled():void{
    if(process.env.SERVICES_ENABLE_GUEST_SCHEDULE_HTTP!=='enabled')throw new NotFoundException();
  }
}
