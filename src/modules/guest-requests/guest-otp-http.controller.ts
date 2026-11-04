import {
  Body,Controller,Header,HttpCode,NotFoundException,Param,Post,
  ServiceUnavailableException,UnauthorizedException,
} from '@nestjs/common';
import {GuestOtpDispatchService} from './guest-otp-dispatch.service.js';
import {GuestChallengeVerificationService} from './guest-challenge-verification.service.js';

type ChallengeBody={channel:'sms'|'email';contact:string;locale:'kk'|'ru'};
type VerifyBody={code:string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireOtpHttpEnabled():void{
  if(process.env.SERVICES_ENABLE_GUEST_OTP_HTTP!=='enabled')
    throw new NotFoundException();
}

/**
 * The OTP provider defaults to unavailable and all guest OTP HTTP calls are
 * independently disabled by default. These endpoints are intended ONLY for
 * an approved server-side BFF behind trusted ingress and network budgets.
 * OTP and CREATE_REQUEST credentials must never be sent to browser JavaScript.
 */
@Controller('guest-requests/challenges')
export class GuestOtpHttpController{
  constructor(
    private readonly dispatch:GuestOtpDispatchService,
    private readonly verifyService:GuestChallengeVerificationService,
  ){}

  @Post()
  @HttpCode(202)
  @Header('Cache-Control','private, no-store, max-age=0')
  @Header('Pragma','no-cache')
  @Header('X-Robots-Tag','noindex, nofollow')
  async requestCode(@Body() body:unknown):
    Promise<{challenge_id:string}>{
    requireOtpHttpEnabled();
    if(!body||typeof body!=='object'||Array.isArray(body)){
      throw new ServiceUnavailableException('OTP temporarily unavailable');
    }
    const input=body as Record<string,unknown>;
    if(Object.keys(input).some(key=>!['channel','contact','locale'].includes(key))||
       (input.channel!=='sms'&&input.channel!=='email')||
       typeof input.contact!=='string'||input.contact.length>320||
       (input.locale!=='kk'&&input.locale!=='ru')){
      throw new ServiceUnavailableException('OTP temporarily unavailable');
    }
    // Do not return a code or verified contact; only a challenge ID. The
    // delivery service remains disabled until KZ-resident provider review.
    const dispatched=await this.dispatch.dispatchCreateRequest(
      input.channel,input.contact,input.locale,
    );
    return {challenge_id:dispatched.challengeId};
  }

  @Post(':id/verify')
  @HttpCode(200)
  @Header('Cache-Control','private, no-store, max-age=0')
  @Header('Pragma','no-cache')
  @Header('X-Robots-Tag','noindex, nofollow')
  async verifyCode(
    @Param('id') challengeId:unknown,
    @Body() body:unknown,
  ):Promise<{guest_capability:string;expires_at:string}>{
    requireOtpHttpEnabled();
    if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).length!==1||
      typeof (body as VerifyBody).code!=='string'||
      !/^[0-9]{6}$/.test((body as VerifyBody).code)||
      typeof challengeId!=='string'||!UUID.test(challengeId)){
      throw new UnauthorizedException('Invalid or expired verification code');
    }
    const proof=await this.verifyService.verifyCreateRequest(
      challengeId,(body as VerifyBody).code,
    );
    // This sensitive response MUST be consumed only by the trusted BFF,
    // which seals it in HttpOnly cookies. Not a browser-visible API token.
    return {
      guest_capability:proof.guestCapability,
      expires_at:new Date(Date.now()+proof.expiresInSeconds*1000).toISOString(),
    };
  }
}
