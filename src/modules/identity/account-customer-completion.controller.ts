import {
 BadRequestException,Body,Controller,Header,Headers,HttpCode,Inject,Param,Post,
} from '@nestjs/common';
import {requireBearerSession} from '../requests/seller-inbox.contract.js';
import {AccountBearerSessionService} from './account-bearer-session.service.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Bearer-only account transport. This endpoint deliberately does not accept
 * session cookies or client-selected customer identity. Browser clients must
 * use a separately authenticated same-origin BFF with CSRF protection.
 */
@Controller('account/requests')
export class AccountCustomerCompletionController{
 constructor(@Inject(AccountBearerSessionService)
  private readonly account:AccountBearerSessionService){}

 @Post(':id/complete')
 @HttpCode(200)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Content-Type-Options','nosniff')
 @Header('Referrer-Policy','no-referrer')
 @Header('X-Robots-Tag','noindex, nofollow')
 async complete(
  @Headers('authorization') authorization:unknown,
  @Param('id') requestId:unknown,
  @Headers('if-match') ifMatch:unknown,
  @Body() body:unknown,
 ){
  const token=requireBearerSession(authorization);
  if(typeof requestId!=='string'||!UUID.test(requestId))
   throw new BadRequestException('Invalid request ID');
  if(typeof ifMatch!=='string'||!/^"[1-9][0-9]{0,9}"$/.test(ifMatch))
   throw new BadRequestException('If-Match must be a strong positive version');
  if(!body||typeof body!=='object'||Array.isArray(body)||
   Object.getPrototypeOf(body)!==Object.prototype||Object.keys(body).length!==0)
   throw new BadRequestException('Expected empty JSON object');
  const expectedVersion=Number(ifMatch.slice(1,-1));
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)
   throw new BadRequestException('Invalid If-Match');
  return this.account.completeOwnRequest(token,requestId.toLowerCase(),expectedVersion);
 }
}
