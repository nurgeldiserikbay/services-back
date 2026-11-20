import {
 Body,ConflictException,Controller,Header,Headers,HttpCode,Inject,
 NotFoundException,Param,Post,ServiceUnavailableException,UnauthorizedException,
} from '@nestjs/common';
import {GuestOtpDispatchService} from './guest-otp-dispatch.service.js';
import {GuestChallengeVerificationService}
 from './guest-challenge-verification.service.js';
import {verifyTrustedNetworkProof} from './guest-network-quota.js';
import {requireSecret} from './guest-request.security.js';
import {GuestCompletionService} from '../requests/guest-completion.service.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const ENTRIES=(value:unknown):Record<string,unknown>|null=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||
   Object.getPrototypeOf(value)!==Object.prototype)return null;
 return value as Record<string,unknown>;
};
function requireEnabled():void{
 // This is an internal service-to-service boundary ONLY. Ingress must block
 // arbitrary internet access, strip untrusted proof headers and terminate TLS.
 if(process.env.SERVICES_ENABLE_GUEST_COMPLETION_HTTP!=='enabled')
  throw new NotFoundException();
}

/**
 * Default-off, BFF-only guest completion HTTP flow.
 * READ_CANCEL can initiate a fresh OTP to the original verified contact but
 * cannot verify an OTP or complete the request. The verified completion
 * capability is returned ONLY to the trusted BFF, never to browser JS.
 */
@Controller('guest-requests/:id/completion')
export class GuestCompletionHttpController {
 constructor(
  @Inject(GuestOtpDispatchService) private readonly dispatch:GuestOtpDispatchService,
  @Inject(GuestChallengeVerificationService)
  private readonly verifyService:GuestChallengeVerificationService,
  @Inject(GuestCompletionService) private readonly completion:GuestCompletionService,
 ){}

 @Post('challenges')
 @HttpCode(202)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Content-Type-Options','nosniff')
 @Header('X-Robots-Tag','noindex, nofollow')
 async issue(
  @Param('id') id:unknown,
  @Headers('guest-capability') readCapability:unknown,
  @Headers('x-services-network-proof') networkProof:unknown,
  @Body() body:unknown,
 ):Promise<{challenge_id:string}>{
  requireEnabled();
  const input=ENTRIES(body);
  if(!input||Object.keys(input).length!==1||
     (input.locale!=='kk'&&input.locale!=='ru')||
     typeof id!=='string'||!UUID.test(id)||
     typeof readCapability!=='string'||!TOKEN.test(readCapability))
   throw new NotFoundException('Request unavailable');
  let networkDigest:string|null=null;
  try{
   const key=requireSecret(process.env.GUEST_NETWORK_ATTESTATION_KEY);
   networkDigest=verifyTrustedNetworkProof(networkProof,key);
  }catch{/* Missing or untrusted network attestation: no OTP dispatch. */}
  if(!networkDigest)
   throw new ServiceUnavailableException('OTP temporarily unavailable');
  const proof=await this.dispatch.dispatchCompleteRequest(
   id,readCapability,input.locale,networkDigest);
  if(!proof)throw new NotFoundException('Request unavailable');
  return {challenge_id:proof.challengeId};
 }

 @Post('challenges/:challengeId/verify')
 @HttpCode(200)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Content-Type-Options','nosniff')
 @Header('X-Robots-Tag','noindex, nofollow')
 async verify(
  @Param('id') id:unknown,
  @Param('challengeId') challengeId:unknown,
  @Body() body:unknown,
 ):Promise<{guest_capability:string;expires_at:string}>{
  requireEnabled();
  const input=ENTRIES(body);
  if(typeof id!=='string'||!UUID.test(id)||
     typeof challengeId!=='string'||!UUID.test(challengeId)||
     !input||Object.keys(input).length!==1||
     typeof input.code!=='string'||!/^[0-9]{6}$/.test(input.code))
   throw new UnauthorizedException('Invalid or expired verification code');
  const verified=await this.verifyService.verifyCompleteRequest(
   id,challengeId,input.code);
  return {guest_capability:verified.guestCapability,
   expires_at:new Date(Date.now()+verified.expiresInSeconds*1000).toISOString()};
 }

 @Post('confirm')
 @HttpCode(200)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Content-Type-Options','nosniff')
 @Header('X-Robots-Tag','noindex, nofollow')
 async confirm(
  @Param('id') id:unknown,
  @Headers('guest-completion-capability') capability:unknown,
  @Headers('if-match') version:unknown,
  @Body() body:unknown,
 ):Promise<{id:string;state:'completed';version:number}>{
  requireEnabled();
  const input=ENTRIES(body);
  if(typeof id!=='string'||!UUID.test(id)||
     typeof capability!=='string'||!TOKEN.test(capability))
   throw new NotFoundException('Request unavailable');
  if(!input||Object.keys(input).length!==0||
     typeof version!=='string'||!/^"[1-9][0-9]{0,9}"$/.test(version))
   throw new ConflictException('Invalid request precondition');
  const expectedVersion=Number(version.slice(1,-1));
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion>2147483646)
   throw new ConflictException('Invalid request precondition');
  return this.completion.confirm(id,capability,expectedVersion);
 }
}
