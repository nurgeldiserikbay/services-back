import {Controller,Get,Header,Headers} from '@nestjs/common';
import {PlatformModerationReadService} from './admin-moderation-read.service.js';

/** Private BFF-only endpoint; never expose administrator bearer in browser. */
@Controller('admin/moderation')
export class PlatformModerationReadController{
 constructor(private readonly service:PlatformModerationReadService){}
 @Get('cases')
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 list(@Headers('authorization') bearer:unknown){
  return this.service.list(bearer);
 }
}
