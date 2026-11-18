import {Body,Controller,Header,Headers,HttpCode,Inject,Param,Post} from '@nestjs/common';
import {assertPrivateAppealTransport} from './admin-professional-appeal-private-transport.js';
import {PlatformProfessionalAppealAdminService} from './admin-professional-appeal-http.service.js';

/** Prepared private server-to-server transport. Not registered in production modules. */
@Controller('admin/moderation/appeals')
export class PlatformProfessionalAppealAdminController{
 constructor(@Inject(PlatformProfessionalAppealAdminService) private readonly service:PlatformProfessionalAppealAdminService){}


 @Post(':id/assignment')
 @HttpCode(200)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 @Header('Referrer-Policy','no-referrer')
 @Header('X-Content-Type-Options','nosniff')
 @Header('Vary','Authorization')
 assign(@Headers() headers:Record<string,unknown>,
  @Param('id') id:unknown,@Body() body:unknown){
  assertPrivateAppealTransport(headers);
  return this.service.assign(headers['authorization'],id,body);
 }

 @Post(':id/decision')
 @HttpCode(200)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 @Header('Referrer-Policy','no-referrer')
 @Header('X-Content-Type-Options','nosniff')
 @Header('Vary','Authorization')
 decide(@Headers() headers:Record<string,unknown>,
  @Param('id') id:unknown,@Body() body:unknown){
  assertPrivateAppealTransport(headers);
  return this.service.decide(headers['authorization'],id,body);
 }
}
