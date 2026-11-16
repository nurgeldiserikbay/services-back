import {
 Body,Controller,Header,Headers,HttpCode,NotFoundException,Post,
 UnauthorizedException,
} from '@nestjs/common';
import {requirePrivateAdminMfaAccess} from './admin-mfa-private-auth.js';
import {parsePrivateAdminMfaRequest} from './admin-mfa-private-request.js';

/**
 * Private MFA exchange boundary. Intentionally not registered in a Nest module
 * until a trusted database pool and vault-backed key resolver are wired.
 * Transport access is checked BEFORE inspecting the request body.
 */
@Controller('admin/private/mfa')
export class PrivateAdminMfaController{
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
 ):Promise<never>{
  requirePrivateAdminMfaAccess(access);
  if(!parsePrivateAdminMfaRequest(body))
   throw new UnauthorizedException('Invalid admin authentication');
  // Fail closed until server-side account proof, vault key resolver and
  // atomic MFA transaction are injected. Never return a fake bearer.
  throw new NotFoundException();
 }
}
