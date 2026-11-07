import {BadRequestException,Controller,Get,Header,Headers,Query} from '@nestjs/common';
import {requireBearerSession} from '../requests/seller-inbox.contract.js';
import {PersonInboxService} from './person-inbox.service.js';

/** Native / server-side bearer only. Browser must use an authenticated BFF. */
@Controller('me/notifications')
export class PersonInboxController {
 constructor(private readonly inbox:PersonInboxService){}
 @Get()
 @Header('Cache-Control','private, no-store')
 @Header('Pragma','no-cache')
 @Header('X-Robots-Tag','noindex, nofollow')
 async list(@Headers('authorization') auth:unknown,@Query('limit') limit:unknown){
  const token=requireBearerSession(auth);
  if(limit!==undefined&&(typeof limit!=='string'||!/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit)))
   throw new BadRequestException('Invalid notification limit');
  return this.inbox.list(token,limit===undefined?20:Number(limit));
 }
}
