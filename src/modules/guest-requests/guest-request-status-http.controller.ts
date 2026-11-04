import {
  Controller,Get,Param,Headers,Header,NotFoundException,
} from '@nestjs/common';
import {GuestRequestStatusService,type GuestRequestStatus}
  from './guest-request-status.service.js';

/**
 * Explicitly disabled unless a deployment enables the reviewed server-to-
 * server ingress. No cookie authentication or URL-based proof is accepted.
 * Browser access via the first-party BFF requires a separately approved flow.
 */
@Controller('requests')
export class GuestRequestStatusHttpController{
  constructor(private readonly statuses:GuestRequestStatusService){}

  @Get(':id')
  @Header('Cache-Control','private, no-store, max-age=0')
  @Header('Pragma','no-cache')
  @Header('X-Robots-Tag','noindex, nofollow')
  async getOwnStatus(
    @Param('id') id:unknown,
    @Headers('guest-capability') capability:unknown,
  ):Promise<GuestRequestStatus>{
    // The route is present in router metadata, but never executes a
    // database lookup on an unapproved environment. Fail closed by default.
    if(process.env.SERVICES_ENABLE_GUEST_STATUS_HTTP!=='enabled')
      throw new NotFoundException();
    return this.statuses.getOwnStatus(id,capability);
  }
}
