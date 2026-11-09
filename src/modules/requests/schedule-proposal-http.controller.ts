import {
  Controller,Post,Param,Headers,Body,HttpCode,Header,
  BadRequestException,ConflictException,ForbiddenException,NotFoundException,
} from '@nestjs/common';
import {validateSellerDecisionHttp} from './seller-decision-http.contract.js';
import {validateScheduleProposalBody,type ScheduleProposalInput} from './schedule-proposal.contract.js';
import {ScheduleProposalHttpService} from './schedule-proposal-http.service.js';
import {ScheduleProposalRejected,type ScheduleProposalAction,type ScheduleProposalCommandResult}
  from './schedule-proposal.transaction.js';
import {validateIdempotencyKey} from '../guest-requests/guest-request.validation.js';
import {UnauthorizedException} from '@nestjs/common';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY=/^[A-Za-z0-9_-]{43}$/;
type ParsedMutation={token?:string;guestCapability?:string;requestId:string;expectedVersion:number;key:string};

/** Schedule proposals accept account bearer sessions or request-scoped guest proofs. */
@Controller('requests')
export class ScheduleProposalHttpController{
  constructor(private readonly service:ScheduleProposalHttpService){}

  @Post(':id/schedule-proposals')
  @HttpCode(201)
  @Header('Cache-Control','no-store')
  propose(
    @Param('id') id:unknown,@Headers('authorization') authorization:unknown,
    @Headers('guest-capability') guestCapability:unknown,
    @Headers('if-match') version:unknown,@Headers('idempotency-key') key:unknown,
    @Body() body:unknown,
  ):Promise<ScheduleProposalCommandResult>{
    return this.run('propose',id,authorization,guestCapability,version,key,validateScheduleProposalBody(body));
  }

  @Post(':id/schedule-proposals/:proposalId/decline')
  @HttpCode(200)
  @Header('Cache-Control','no-store')
  decline(
    @Param('id') id:unknown,@Param('proposalId') proposalId:unknown,
    @Headers('authorization') authorization:unknown,@Headers('if-match') version:unknown,
    @Headers('guest-capability') guestCapability:unknown,
    @Headers('idempotency-key') key:unknown,
  ):Promise<ScheduleProposalCommandResult>{
    const parsed=validateMutation({authorization,guestCapability,requestId:id,version,idempotencyKey:key});
    if(typeof proposalId!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(proposalId)){
      throw new BadRequestException('Invalid schedule proposal ID');
    }
    return this.execute('decline',parsed,undefined,proposalId.toLowerCase());
  }

  @Post(':id/schedule-proposals/:proposalId/confirm')
  @HttpCode(200)
  @Header('Cache-Control','no-store')
  confirm(
    @Param('id') id:unknown,@Param('proposalId') proposalId:unknown,
    @Headers('authorization') authorization:unknown,@Headers('if-match') version:unknown,
    @Headers('guest-capability') guestCapability:unknown,
    @Headers('idempotency-key') key:unknown,
  ):Promise<ScheduleProposalCommandResult>{
    const parsed=validateMutation({authorization,guestCapability,requestId:id,version,idempotencyKey:key});
    if(typeof proposalId!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(proposalId)){
      throw new BadRequestException('Invalid schedule proposal ID');
    }
    return this.execute('confirm',parsed,undefined,proposalId.toLowerCase());
  }

  private async run(
    action:ScheduleProposalAction,id:unknown,authorization:unknown,guestCapability:unknown,version:unknown,key:unknown,
    input:ScheduleProposalInput,
  ):Promise<ScheduleProposalCommandResult>{
    const parsed=validateMutation({authorization,guestCapability,requestId:id,version,idempotencyKey:key});
    return this.execute(action,parsed,input);
  }

  private async execute(
    action:ScheduleProposalAction,
    parsed:ParsedMutation,
    input?:ScheduleProposalInput,proposalId?:string,
  ):Promise<ScheduleProposalCommandResult>{
    try{
      return await this.service.mutate({...parsed,action,input,proposalId});
    }catch(error){
      if(error instanceof ScheduleProposalRejected){
        if(error.reason==='not_found')throw new NotFoundException();
        if(error.reason==='forbidden')throw new ForbiddenException();
        throw new ConflictException('Schedule proposal state or version conflict');
      }
      throw error;
    }
  }
}

function validateMutation(input:{authorization:unknown;guestCapability:unknown;
  requestId:unknown;version:unknown;idempotencyKey:unknown}):ParsedMutation{
  if(input.authorization!==undefined&&input.authorization!==null){
    const account=validateSellerDecisionHttp(input);
    if(input.guestCapability!==undefined&&input.guestCapability!==null)
      throw new UnauthorizedException('Use one schedule credential');
    return account;
  }
  if(typeof input.guestCapability!=='string'||!CAPABILITY.test(input.guestCapability))
    throw new UnauthorizedException('Authentication required');
  if(typeof input.requestId!=='string'||!UUID.test(input.requestId))
    throw new BadRequestException('Invalid request ID');
  if(typeof input.version!=='string'||!/^"[1-9][0-9]{0,9}"$/.test(input.version))
    throw new BadRequestException('If-Match must be a quoted positive version');
  const expectedVersion=Number(input.version.slice(1,-1));
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)
    throw new BadRequestException('Invalid If-Match');
  return {guestCapability:input.guestCapability,requestId:input.requestId.toLowerCase(),
    expectedVersion,key:validateIdempotencyKey(input.idempotencyKey)};
}
