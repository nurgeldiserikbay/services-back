import {Controller,Get,Header,Headers,Inject} from '@nestjs/common';
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
}
