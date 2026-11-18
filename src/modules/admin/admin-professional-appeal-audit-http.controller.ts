import {Controller,Get,Header,Headers,Inject,Param,Query,UnauthorizedException} from '@nestjs/common';
import {PlatformProfessionalAppealAuditReadService} from './admin-professional-appeal-audit-http.service.js';

const forbidden=['origin','referer','cookie','sec-fetch-site','sec-fetch-dest','sec-fetch-user'];

/** Prepared isolated server-to-server audit transport, NEVER registered in app. */
@Controller('admin/moderation/appeals')
export class PlatformProfessionalAppealAuditReadController{
 constructor(@Inject(PlatformProfessionalAppealAuditReadService) private readonly service:PlatformProfessionalAppealAuditReadService){}
 @Get(':id/audit')
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 @Header('Referrer-Policy','no-referrer')
 @Header('X-Content-Type-Options','nosniff')
 @Header('Vary','Authorization')
 read(@Headers() headers:Record<string,unknown>,@Param('id') id:unknown,
  @Query('profile_id') profileId:unknown){
  if(!headers||typeof headers!=='object'||Array.isArray(headers)||
    forbidden.some(key=>headers[key]!==undefined)||
    (headers['sec-fetch-mode']!==undefined&&headers['sec-fetch-mode']!=='cors'))
   throw new UnauthorizedException('Authentication required');
  return this.service.read(headers['authorization'],id,profileId);
 }
}
