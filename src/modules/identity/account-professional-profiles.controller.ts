import {Body,Controller,Get,Header,NotFoundException,Headers,Inject,Param,Patch,Post} from '@nestjs/common';
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
 @Get(':id/preview')
 @Header('Cache-Control','private, no-store')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 preview(@Headers('authorization') authorization:unknown,@Param('id') id:unknown){
  if(process.env.SERVICES_ENABLE_PROFILE_PREVIEW!=='enabled')throw new NotFoundException('Profile unavailable');
  return this.sessions.previewProfessionalProfile(requireBearerSession(authorization),id);
 }
 @Post(':id/publish')
 @Header('Cache-Control','private, no-store')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 publish(@Headers('authorization') authorization:unknown,@Param('id') id:unknown,@Headers('if-match') match:unknown,@Body() body:unknown){
  if(process.env.SERVICES_ENABLE_PROFILE_PUBLISH!=='enabled')throw new NotFoundException('Profile unavailable');
  return this.sessions.publishProfessionalProfile(requireBearerSession(authorization),id,match,body);
 }
 @Get(':id/appealable-rejection')
 @Header('Cache-Control','private, no-store')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 appealableRejection(@Headers('authorization') authorization:unknown,@Param('id') id:unknown){
  if(process.env.SERVICES_ENABLE_PROFILE_APPEALS!=='enabled')throw new NotFoundException('Profile unavailable');
  return this.sessions.appealableProfessionalRejection(requireBearerSession(authorization),id);
 }
 @Post(':id/appeals')
 @Header('Cache-Control','private, no-store')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 appeal(@Headers('authorization') authorization:unknown,@Param('id') id:unknown,@Headers('if-match') match:unknown,@Body() body:unknown){
  if(process.env.SERVICES_ENABLE_PROFILE_APPEALS!=='enabled')throw new NotFoundException('Profile unavailable');
  return this.sessions.appealProfessionalProfile(requireBearerSession(authorization),id,match,body);
 }
 @Patch(':id')
 @Header('Cache-Control','private, no-store')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 update(@Headers('authorization') authorization:unknown,@Param('id') id:unknown,@Headers('if-match') match:unknown,@Body() body:unknown){
  return this.sessions.updateProfessionalProfile(requireBearerSession(authorization),id,match,body);
 }
}
