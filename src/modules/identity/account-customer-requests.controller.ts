import {BadRequestException,Controller,Get,Header,Headers,Inject,Query} from '@nestjs/common';
import {requireBearerSession} from '../requests/seller-inbox.contract.js';
import {CustomerRequestInventoryRejected} from '../requests/customer-request-inventory.repository.js';
import {AccountBearerSessionService} from './account-bearer-session.service.js';

/** Registered customer only; no browser cookie, unscoped user ID or contact. */
@Controller('account/requests')
export class AccountCustomerRequestsController{
 constructor(@Inject(AccountBearerSessionService)
  private readonly account:AccountBearerSessionService){}
 @Get()
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Content-Type-Options','nosniff')
 @Header('X-Robots-Tag','noindex, nofollow')
 @Header('Referrer-Policy','no-referrer')
 async list(@Headers('authorization') bearer:unknown,
  @Query('cursor') cursor:unknown){
  const token=requireBearerSession(bearer);
  try{return await this.account.ownRequests(token,cursor);}
  catch(error){
   if(error instanceof CustomerRequestInventoryRejected)
    throw new BadRequestException('Invalid pagination cursor');
   throw error;
  }
 }
}
