import {
 Body,Controller,Header,Headers,HttpCode,Inject,NotFoundException,Post,
} from '@nestjs/common';
import {requireBearerSession} from '../requests/seller-inbox.contract.js';
import {validateGuestRequestBody,validateIdempotencyKey} from
 '../guest-requests/guest-request.validation.js';
import {AccountBearerSessionService} from './account-bearer-session.service.js';

/**
 * Bearer-only registered customer endpoint. Disabled until its separately
 * reviewed same-origin browser BFF, CSRF policy and deployment are accepted.
 * Never accepts cookies as session proof or a client-supplied customer ID.
 */
@Controller('account/requests')
export class AccountCustomerRequestCreateController{
 constructor(@Inject(AccountBearerSessionService)
  private readonly account:AccountBearerSessionService){}

 @Post()
 @HttpCode(201)
 @Header('Cache-Control','private, no-store, max-age=0')
 @Header('Pragma','no-cache')
 @Header('X-Content-Type-Options','nosniff')
 @Header('Referrer-Policy','no-referrer')
 @Header('X-Robots-Tag','noindex, nofollow')
 async create(
  @Headers('authorization') authorization:unknown,
  @Headers('idempotency-key') idempotency:unknown,
  @Body() body:unknown,
 ){
  if(process.env.SERVICES_ENABLE_REGISTERED_REQUEST_CREATE_HTTP!=='enabled')
   throw new NotFoundException('Not found');
  const token=requireBearerSession(authorization);
  const key=validateIdempotencyKey(idempotency);
  const input=validateGuestRequestBody(body);
  return this.account.createOwnRequest(token,input,key);
 }
}
