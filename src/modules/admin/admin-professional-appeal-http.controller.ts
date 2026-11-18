import {Body,Controller,Header,Headers,HttpCode,Inject,Param,Post,UnauthorizedException} from '@nestjs/common';
import {PlatformProfessionalAppealAdminService} from './admin-professional-appeal-http.service.js';

/** Prepared private server-to-server transport. Not registered in production modules. */
@Controller('admin/moderation/appeals')
export class PlatformProfessionalAppealAdminController{
 constructor(@Inject(PlatformProfessionalAppealAdminService) private readonly service:PlatformProfessionalAppealAdminService){}

 private assertPrivateJson(origin:unknown,fetchSite:unknown,contentType:unknown){
  if(origin!==undefined&&origin!==null||
    fetchSite!==undefined&&fetchSite!==null&&fetchSite!=='none'||
    typeof contentType!=='string'||
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType))
   throw new UnauthorizedException('Authentication required');
 }

 @Post(':id/assignment')
 @HttpCode(200)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 @Header('Referrer-Policy','no-referrer')
 @Header('X-Content-Type-Options','nosniff')
 @Header('Vary','Authorization')
 assign(@Headers('authorization') authorization:unknown,
  @Headers('origin') origin:unknown,@Headers('sec-fetch-site') fetchSite:unknown,
  @Headers('content-type') contentType:unknown,
  @Param('id') id:unknown,@Body() body:unknown){
  this.assertPrivateJson(origin,fetchSite,contentType);
  return this.service.assign(authorization,id,body);
 }

 @Post(':id/decision')
 @HttpCode(200)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 @Header('Referrer-Policy','no-referrer')
 @Header('X-Content-Type-Options','nosniff')
 @Header('Vary','Authorization')
 decide(@Headers('authorization') authorization:unknown,
  @Headers('origin') origin:unknown,@Headers('sec-fetch-site') fetchSite:unknown,
  @Headers('content-type') contentType:unknown,
  @Param('id') id:unknown,@Body() body:unknown){
  this.assertPrivateJson(origin,fetchSite,contentType);
  return this.service.decide(authorization,id,body);
 }
}
