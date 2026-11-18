import {Inject,Controller,Get,Header,Headers} from '@nestjs/common';
import {requireBearerSession} from '../requests/seller-inbox.contract.js';
import {AccountBearerSessionService} from './account-bearer-session.service.js';

@Controller('me')
export class AccountMeController{
 constructor(@Inject(AccountBearerSessionService) private readonly sessions:AccountBearerSessionService){}
 @Get()
 @Header('Cache-Control','private, no-store')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 me(@Headers('authorization') authorization:unknown){
  return this.sessions.me(requireBearerSession(authorization));
 }
}
