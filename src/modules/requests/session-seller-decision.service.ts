import {Injectable,UnauthorizedException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {resolveActiveUserSession} from '../identity/session-proof.js';
import {resolveSellerDecisionAuthority} from './seller-authority.js';
import {
  decideSellerRequest,type SellerDecision,type DecisionResult,
  SellerDecisionRejected,
} from './seller-decision.transaction.js';

/**
 * Internal integration boundary: token -> active session -> authorized seller
 * -> transition, all on the same PostgreSQL transaction connection.
 * No controller exposed. Browser cookie & CSRF/Origin must be verified by a
 * separate BFF; native short-lived proof requires secure login lifecycle.
 */
@Injectable()
export class SessionSellerDecisionService{
  constructor(private readonly db:DatabasePool){}

  async decideWithSession(
    opaqueSessionToken:string,
    requestId:string,
    decision:SellerDecision,
    expectedVersion:number,
  ):Promise<DecisionResult>{
    const pepper=requireSecret(process.env.ACCOUNT_SESSION_HMAC_KEY);
    return this.db.transaction(async client=>{
      const session=await resolveActiveUserSession(client,opaqueSessionToken,pepper);
      if(!session)throw new UnauthorizedException('Authentication required');
      const seller=await resolveSellerDecisionAuthority(client,session.userId,requestId);
      if(!seller.authorized)throw new SellerDecisionRejected('forbidden');
      return decideSellerRequest(client,requestId,seller.seller,decision,expectedVersion);
    });
  }
}
