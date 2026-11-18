import {Inject,Controller,Post,Param,Req,HttpCode,Header,NotFoundException,
  ConflictException} from '@nestjs/common';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {GuestCancellationService} from './guest-cancel.service.js';
import {GuestCancellationRejected,type GuestCancellationResult}
  from './guest-cancel.transaction.js';
import {verifyGuestCancelBffAttestation} from './guest-cancel-bff-attestation.js';

type RawRequest={rawBody?:Buffer;rawHeaders?:string[]};

function singleHeader(request:RawRequest,name:string):string|undefined{
  const headers=request.rawHeaders;
  if(!Array.isArray(headers)||headers.length%2!==0)return undefined;
  let value:string|undefined;
  for(let i=0;i<headers.length;i+=2){
    if(headers[i].toLowerCase()!==name)continue;
    if(value!==undefined)return undefined;
    value=headers[i+1];
  }
  return value;
}

/**
 * Disabled by default. Only a trusted BFF may sign after verifying the
 * sealed request session, CSRF and Origin. Private TLS ingress and BFF
 * integration require release review before enabling the feature.
 */
@Controller('requests')
export class GuestCancelHttpController{
  constructor(@Inject(GuestCancellationService) private readonly service:GuestCancellationService){}

  @Post(':id/cancel')
  @HttpCode(200)
  @Header('Cache-Control','private, no-store, max-age=0')
  @Header('Pragma','no-cache')
  @Header('X-Robots-Tag','noindex, nofollow')
  async cancel(@Param('id') id:unknown,@Req() request:RawRequest):
    Promise<GuestCancellationResult>{
    if(process.env.SERVICES_ENABLE_GUEST_CANCEL_HTTP!=='enabled')
      throw new NotFoundException();
    const body=request.rawBody;
    const type=singleHeader(request,'content-type');
    if(!Buffer.isBuffer(body)||body.length>128||
      typeof type!=='string'||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(type))
      throw new NotFoundException();
    let rawBody:string,secret:Buffer;
    try{
      rawBody=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(body);
      secret=requireSecret(process.env.GUEST_CANCEL_BFF_HMAC_KEY);
      // Ensure the ingress signing key cannot be reused as either domain key.
      if(secret.equals(requireSecret(process.env.GUEST_REQUEST_HMAC_KEY))||
        secret.equals(requireSecret(process.env.GUEST_CANCEL_LEDGER_HMAC_KEY)))
        throw new Error('invalid_configuration');
    }catch{throw new NotFoundException();}
    const capability=singleHeader(request,'guest-capability');
    const command=verifyGuestCancelBffAttestation({
      requestId:id,rawBody,capability,
      idempotencyKey:singleHeader(request,'idempotency-key'),
      attestation:singleHeader(request,'x-services-guest-cancel-proof'),
    },secret);
    if(!command||!capability)throw new NotFoundException();
    try{
      const result=await this.service.cancelIdempotently(command.requestId,
        capability,command.expectedVersion,command.idempotencyKey);
      return {id:result.id,state:result.state,version:result.version};
    }catch(error){
      if(error instanceof GuestCancellationRejected){
        if(error.reason==='conflict')throw new ConflictException('Cancellation conflict');
        throw new NotFoundException();
      }
      // Do not expose database or private configuration details.
      throw new NotFoundException();
    }
  }
}
