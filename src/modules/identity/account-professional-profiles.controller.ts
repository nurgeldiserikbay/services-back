import {Body,Controller,Get,Header,Headers,Inject,Post} from '@nestjs/common';
import {requireBearerSession} from '../requests/seller-inbox.contract.js';
import {AccountBearerSessionService} from './account-bearer-session.service.js';

@Controller('me/professional-profiles')
export class AccountProfessionalProfilesController{
 constructor(@Inject(AccountBearerSessionService) private readonly sessions:AccountBearerSessionService){}
 @Get()
 @Header('Cache-Control','private, no-store')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 list(@Headers('authorization') authorization:unknown){
  return this.sessions.professionalProfiles(requireBearerSession(authorization));
 }
 @Post()
 @Header('Cache-Control','private, no-store')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 create(@Headers('authorization') authorization:unknown,@Headers('idempotency-key') key:unknown,@Body() body:unknown){
  return this.sessions.createProfessionalProfile(requireBearerSession(authorization),body,key);
 }
}
