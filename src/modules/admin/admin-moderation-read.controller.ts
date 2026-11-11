import {Controller,Get,Header,Headers,Inject} from '@nestjs/common';
import {PlatformModerationReadService} from './admin-moderation-read.service.js';

/** Private BFF-only endpoint; never expose administrator bearer in browser. */
@Controller('admin/moderation')
export class PlatformModerationReadController{
 constructor(@Inject(PlatformModerationReadService) private readonly service:PlatformModerationReadService){}
 @Get('cases')
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 @Header('Referrer-Policy','no-referrer')
 @Header('Vary','Authorization')
 @Header('X-Content-Type-Options','nosniff')
 list(@Headers('authorization') bearer:unknown){
  return this.service.list(bearer);
 }
}
