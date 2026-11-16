import {
 Body,Controller,Header,Headers,HttpCode,Inject,Post,
 ServiceUnavailableException,UnauthorizedException,
} from '@nestjs/common';
import {
 exchangePrivateAdminMfa,type PrivateAdminMfaDependencies,
} from './admin-mfa-private-exchange.js';

/**
 * Only the trusted server-side integration module may provide this token.
 * Never populate it from HTTP input. The controller remains UNREGISTERED
 * until a vault-backed key resolver and restricted private ingress exist.
 */
export const PRIVATE_ADMIN_MFA_DEPS='PRIVATE_ADMIN_MFA_DEPS';

@Controller('admin/private/mfa')
export class PrivateAdminMfaController{
 constructor(
  @Inject(PRIVATE_ADMIN_MFA_DEPS)
  private readonly dependencies:PrivateAdminMfaDependencies,
 ){}

 @Post('verify')
 @HttpCode(200)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 @Header('Referrer-Policy','no-referrer')
 @Header('X-Content-Type-Options','nosniff')
 @Header('Vary','X-Services-Admin-Mfa-Key')
 async verify(
  @Headers('x-services-admin-mfa-key') access:unknown,
  @Body() body:unknown,
 ):Promise<{session_token:string;expires_at:number}>{
  let result:{session_token:string;expires_at:number}|null;
  try{
   result=await exchangePrivateAdminMfa(access,body,this.dependencies);
  }catch(error){
   // Preserve the transport's fail-closed NotFoundException; do not expose
   // database, secret-manager or cryptographic driver exception messages.
   if(error instanceof Error&&error.name==='NotFoundException')throw error;
   throw new ServiceUnavailableException('Admin authentication unavailable');
  }
  if(!result)throw new UnauthorizedException('Invalid admin authentication');
  return result;
 }
}
