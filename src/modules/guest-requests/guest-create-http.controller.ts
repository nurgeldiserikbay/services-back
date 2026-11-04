import {
  Body,ConflictException,Controller,ForbiddenException,Header,Headers,
  HttpCode,NotFoundException,Post,
} from '@nestjs/common';
import {GuestRequestService} from './guest-request.service.js';
import {GuestRequestRejected} from './guest-request.transaction.js';

export type GuestCreatedHttpResponse=Readonly<{
  id:string;
  state:'pending';
  request_capability:string;
  expires_at:string;
}>;

/**
 * HTTP adapter for a pre-verified, single-use guest CREATE_REQUEST proof.
 *
 * WARNING: disabled by default. The capability is a bearer secret and only
 * an approved same-origin BFF may expose this workflow to browsers. Browser
 * CORS intentionally disallows Guest-Capability and POST.
 */
@Controller('guest-requests')
export class GuestCreateHttpController{
  constructor(private readonly requests:GuestRequestService){}

  @Post()
  @HttpCode(201)
  @Header('Cache-Control','private, no-store, max-age=0')
  @Header('Pragma','no-cache')
  @Header('X-Robots-Tag','noindex, nofollow')
  async create(
    @Body() body:unknown,
    @Headers('guest-capability') capability:unknown,
    @Headers('idempotency-key') idempotencyKey:unknown,
  ):Promise<GuestCreatedHttpResponse>{
    // Fail before validation or a database query until security review,
    // deployment ingress and OTP-provider/BFF gates are explicitly approved.
    if(process.env.SERVICES_ENABLE_GUEST_CREATE_HTTP!=='enabled')
      throw new NotFoundException();
    try{
      const created=await this.requests.createFromVerifiedContact(
        body,capability as string,idempotencyKey,
      );
      // Do not expose camelCase internal DTO or any other domain fields.
      return {
        id:created.id,state:'pending',
        request_capability:created.requestCapability,
        expires_at:created.expiresAt,
      };
    }catch(error){
      if(error instanceof GuestRequestRejected){
        if(error.reason==='idempotency_conflict')
          throw new ConflictException('Guest request conflicts with prior submission');
        // Do not disclose whether an offer or contact/proof exists.
        throw new ForbiddenException('Guest request unavailable');
      }
      throw error;
    }
  }
}
