import {Controller,Header,Headers,HttpCode,Inject,Post} from '@nestjs/common';
import {PlatformAdminLogoutService} from './admin-logout.service.js';

@Controller('admin/session')
export class PlatformAdminLogoutController{
 constructor(@Inject(PlatformAdminLogoutService) private readonly service:PlatformAdminLogoutService){}
 @Post('logout')
 @HttpCode(200)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 @Header('Referrer-Policy','no-referrer')
 @Header('Vary','Authorization')
 @Header('X-Content-Type-Options','nosniff')
 async logout(@Headers('authorization') authorization:unknown){
  await this.service.logout(authorization);
  return {status:'revoked'};
 }
}
