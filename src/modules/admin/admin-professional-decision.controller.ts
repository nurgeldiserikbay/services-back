import {Body,Controller,Header,Headers,HttpCode,Inject,Param,Post,UnauthorizedException} from '@nestjs/common';
import {PlatformProfessionalDecisionService} from './admin-professional-decision.service.js';

/** Private admin API; disallow browser-origin mutation, even with a stolen bearer. */
@Controller('admin/moderation')
export class PlatformProfessionalDecisionController{
 constructor(@Inject(PlatformProfessionalDecisionService) private readonly service:PlatformProfessionalDecisionService){}
 @Post('cases/:id/decision')
 @HttpCode(200)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 @Header('Referrer-Policy','no-referrer')
 @Header('Vary','Authorization')
 @Header('X-Content-Type-Options','nosniff')
 decide(@Headers('authorization') authorization:unknown,
  @Headers('origin') origin:unknown,@Headers('sec-fetch-site') fetchSite:unknown,
  @Headers('content-type') contentType:unknown,
  @Param('id') id:unknown,@Body() body:unknown){
  if(origin!==undefined&&origin!==null||
     fetchSite!==undefined&&fetchSite!==null&&fetchSite!=='none'||
     typeof contentType!=='string'||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType))
   throw new UnauthorizedException('Authentication required');
  return this.service.decide(authorization,id,body);
 }
}
