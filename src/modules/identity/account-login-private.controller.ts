import {
  Body,Controller,Header,Headers,HttpCode,NotFoundException,Post,
  UnauthorizedException,
} from '@nestjs/common';
import {AccountOtpSignInService} from './account-otp-sign-in.service.js';
import {requirePrivateAccountLoginAccess}
 from './account-login-private-auth.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * PRIVATE SERVER-TO-SERVER boundary only. A browser must never receive this
 * session_token. Keep access gated until OTP vendor, ingress, session cookie,
 * CSRF, abuse controls and provider review are complete.
 */
@Controller('auth/private/account')
export class AccountLoginPrivateController{
 constructor(private readonly signIn:AccountOtpSignInService){}

 @Post('verify')
 @HttpCode(200)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 async verify(@Headers('x-services-account-login-key') access:unknown,
  @Body() body:unknown):Promise<{session_token:string;expires_in_seconds:number}>{
  requirePrivateAccountLoginAccess(access);
  if(!body||typeof body!=='object'||Array.isArray(body)||
   Object.keys(body).sort().join(',')!=='challenge_id,channel,code')
   throw new UnauthorizedException('Invalid or expired verification code');
  const input=body as Record<string,unknown>;
  if(typeof input.challenge_id!=='string'||!UUID.test(input.challenge_id)||
   (input.channel!=='EMAIL'&&input.channel!=='SMS')||
   typeof input.code!=='string'||!/^[0-9]{6}$/.test(input.code))
   throw new UnauthorizedException('Invalid or expired verification code');
  const verified=await this.signIn.signIn({
   challengeId:input.challenge_id,channel:input.channel,code:input.code,
  });
  if(!verified)throw new UnauthorizedException('Invalid or expired verification code');
  return {session_token:verified.sessionToken,
   expires_in_seconds:verified.expiresInSeconds};
 }
}
