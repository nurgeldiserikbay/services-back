import {Injectable} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {
  decideSellerRequest,type SellerDecision,type DecisionResult,
  SellerDecisionRejected,
} from './seller-decision.transaction.js';
import {resolveSellerDecisionAuthority} from './seller-authority.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Internal service only: authentication MUST be done before passing userId.
 * Do not register a public accept/decline endpoint until secure web/native
 * sessions, CSRF/Origin checks, audit, rate limiting and version headers exist.
 */
@Injectable()
export class SellerDecisionService {
  constructor(private readonly database:DatabasePool){}

  async decide(
    authenticatedUserId:string,
    requestId:string,
    decision:SellerDecision,
    expectedVersion:number,
  ):Promise<DecisionResult>{
    if(!UUID.test(authenticatedUserId)||!UUID.test(requestId))
      throw new SellerDecisionRejected('not_found');
    return this.database.transaction(async client=>{
      const gate=await resolveSellerDecisionAuthority(client,authenticatedUserId,requestId);
      if(!gate.authorized)throw new SellerDecisionRejected('forbidden');
      return decideSellerRequest(client,requestId,gate.seller,decision,expectedVersion);
    });
  }
}
