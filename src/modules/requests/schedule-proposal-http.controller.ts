import {
  Controller,Post,Param,Headers,Body,HttpCode,Header,
  BadRequestException,ConflictException,ForbiddenException,NotFoundException,
} from '@nestjs/common';
import {validateSellerDecisionHttp} from './seller-decision-http.contract.js';
import {validateScheduleProposalBody,type ScheduleProposalInput} from './schedule-proposal.contract.js';
import {ScheduleProposalHttpService} from './schedule-proposal-http.service.js';
import {ScheduleProposalRejected,type ScheduleProposalAction,type ScheduleProposalCommandResult}
  from './schedule-proposal.transaction.js';

/** Bearer-only account API. Guest schedule capabilities are intentionally not
 * accepted until their OTP issuance and verification routes are implemented. */
@Controller('requests')
export class ScheduleProposalHttpController{
  constructor(private readonly service:ScheduleProposalHttpService){}

  @Post(':id/schedule-proposals')
  @HttpCode(201)
  @Header('Cache-Control','no-store')
  propose(
    @Param('id') id:unknown,@Headers('authorization') authorization:unknown,
    @Headers('if-match') version:unknown,@Headers('idempotency-key') key:unknown,
    @Body() body:unknown,
  ):Promise<ScheduleProposalCommandResult>{
    return this.run('propose',id,authorization,version,key,validateScheduleProposalBody(body));
  }

  @Post(':id/schedule-proposals/:proposalId/decline')
  @HttpCode(200)
  @Header('Cache-Control','no-store')
  decline(
    @Param('id') id:unknown,@Param('proposalId') proposalId:unknown,
    @Headers('authorization') authorization:unknown,@Headers('if-match') version:unknown,
    @Headers('idempotency-key') key:unknown,
  ):Promise<ScheduleProposalCommandResult>{
    const parsed=validateSellerDecisionHttp({authorization,requestId:id,version,idempotencyKey:key});
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
    @Headers('idempotency-key') key:unknown,
  ):Promise<ScheduleProposalCommandResult>{
    const parsed=validateSellerDecisionHttp({authorization,requestId:id,version,idempotencyKey:key});
    if(typeof proposalId!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(proposalId)){
      throw new BadRequestException('Invalid schedule proposal ID');
    }
    return this.execute('confirm',parsed,undefined,proposalId.toLowerCase());
  }

  private async run(
    action:ScheduleProposalAction,id:unknown,authorization:unknown,version:unknown,key:unknown,
    input:ScheduleProposalInput,
  ):Promise<ScheduleProposalCommandResult>{
    const parsed=validateSellerDecisionHttp({authorization,requestId:id,version,idempotencyKey:key});
    return this.execute(action,parsed,input);
  }

  private async execute(
    action:ScheduleProposalAction,
    parsed:ReturnType<typeof validateSellerDecisionHttp>,
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
