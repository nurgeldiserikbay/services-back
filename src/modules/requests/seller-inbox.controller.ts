import {
  Controller,Get,Header,Headers,Query,
} from '@nestjs/common';
import {SellerInboxService} from './seller-inbox.service.js';
import {
  parseSellerInboxFilter,requireBearerSession,type SellerInboxPage,
} from './seller-inbox.contract.js';

/**
 * Native/server-to-server bearer access only. No cookie session accepted.
 * Browser web app must use an authenticated BFF; global CORS does not allow
 * Authorization or mutating methods. Never log Authorization headers.
 */
@Controller('me/seller-requests')
export class SellerInboxController{
  constructor(private readonly inbox:SellerInboxService){}

  @Get()
  @Header('Cache-Control','private, no-store')
  @Header('Pragma','no-cache')
  get(
    @Headers('authorization') authorization:unknown,
    @Query('limit') limit?:unknown,
    @Query('state') state?:unknown,
    @Query('cursor') cursor?:unknown,
  ):Promise<SellerInboxPage>{
    const bearer=requireBearerSession(authorization);
    const filter=parseSellerInboxFilter({limit,state,cursor});
    return this.inbox.getOwnInbox(bearer,filter);
  }
}
