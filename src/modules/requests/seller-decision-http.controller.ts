import {
  Controller,Post,Param,Headers,HttpCode,Header,
  ConflictException,ForbiddenException,NotFoundException,
} from '@nestjs/common';
import {SellerDecisionHttpService} from './seller-decision-http.service.js';
import {validateSellerDecisionHttp} from './seller-decision-http.contract.js';
import {SellerDecisionRejected,type DecisionResult,type SellerDecision}
  from './seller-decision.transaction.js';

/** No cookie sessions: only explicit native/server bearer credentials.
 * Browser callers must use a same-origin BFF with CSRF and Origin controls.
 */
@Controller('requests')
export class SellerDecisionHttpController{
  constructor(private readonly service:SellerDecisionHttpService){}

  @Post(':id/accept')
  @HttpCode(200)
  @Header('Cache-Control','no-store')
  accept(
    @Param('id') id:unknown,
    @Headers('authorization') authorization:unknown,
    @Headers('if-match') version:unknown,
    @Headers('idempotency-key') key:unknown,
  ):Promise<DecisionResult>{
    return this.run('accept',id,authorization,version,key);
  }

  @Post(':id/decline')
  @HttpCode(200)
  @Header('Cache-Control','no-store')
  decline(
    @Param('id') id:unknown,
    @Headers('authorization') authorization:unknown,
    @Headers('if-match') version:unknown,
    @Headers('idempotency-key') key:unknown,
  ):Promise<DecisionResult>{
    return this.run('decline',id,authorization,version,key);
  }

  private async run(
    action:SellerDecision,id:unknown,
    authorization:unknown,version:unknown,key:unknown,
  ):Promise<DecisionResult>{
    const parsed=validateSellerDecisionHttp({
      authorization,requestId:id,version,idempotencyKey:key,
    });
    try {
      return await this.service.decide(
        parsed.token,parsed.requestId,action,
        parsed.expectedVersion,parsed.key,
      );
    }catch(error){
      if(error instanceof SellerDecisionRejected){
        if(error.reason==='not_found')throw new NotFoundException();
        if(error.reason==='forbidden')throw new ForbiddenException();
        throw new ConflictException('Request state or idempotency conflict');
      }
      throw error;
    }
  }
}
