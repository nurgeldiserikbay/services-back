import {
 Body,Controller,Header,Headers,HttpCode,NotFoundException,Post,
 ServiceUnavailableException,
} from '@nestjs/common';
import {AccountOtpDispatchService}
 from './account-otp-dispatch.service.js';
import {requirePrivateAccountLoginAccess}
 from './account-login-private-auth.js';

const UNAVAILABLE='Account verification temporarily unavailable';
/**
 * Private, non-browser account OTP initiation contract.
 * A trusted BFF must authenticate with its independent key and the ingress
 * must replace/attest the network proof. No provider is registered by default.
 */
@Controller('auth/private/account')
export class AccountOtpDispatchPrivateController{
 constructor(private readonly dispatchService:AccountOtpDispatchService){}

 @Post('challenges')
 @HttpCode(201)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 @Header('X-Content-Type-Options','nosniff')
 async issue(
  @Headers('x-services-account-login-key') access:unknown,
  @Headers('x-services-network-proof') networkProof:unknown,
  @Body() body:unknown,
 ):Promise<{challenge_id:string;expires_in_seconds:number}>{
  // Independent rollout switch: enabling private verify must never
  // automatically enable OTP issuance.
  if(process.env.SERVICES_ENABLE_ACCOUNT_OTP_DISPATCH_HTTP!=='enabled')
   throw new NotFoundException();
  requirePrivateAccountLoginAccess(access);
  if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).sort().join(',')!=='channel,contact,locale,purpose')
   throw new ServiceUnavailableException(UNAVAILABLE);
  const value=body as Record<string,unknown>;
  if((value.channel!=='EMAIL'&&value.channel!=='SMS')||
     (value.purpose!=='SIGN_IN'&&value.purpose!=='SIGN_UP')||
     (value.locale!=='kk'&&value.locale!=='ru')||
     typeof value.contact!=='string'||
     typeof networkProof!=='string'||
     networkProof.length>160)
   throw new ServiceUnavailableException(UNAVAILABLE);
  const result=await this.dispatchService.dispatch({
   channel:value.channel,purpose:value.purpose,locale:value.locale,
   contact:value.contact,networkProof,
  });
  // Never return raw OTP, destination, provider reference or network digest.
  return {challenge_id:result.challengeId,
   expires_in_seconds:result.expiresInSeconds};
 }
}
