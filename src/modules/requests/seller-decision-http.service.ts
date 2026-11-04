import {Injectable} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {decideWithIdempotentSession} from './seller-decision-idempotent.js';
import type {SellerDecision,DecisionResult} from './seller-decision.transaction.js';

@Injectable()
export class SellerDecisionHttpService{
  constructor(private readonly db:DatabasePool){}

  decide(
    token:string,requestId:string,action:SellerDecision,
    expectedVersion:number,key:string,
  ):Promise<DecisionResult>{
    const pepper=requireSecret(process.env.ACCOUNT_SESSION_HMAC_KEY);
    return this.db.transaction(client=>decideWithIdempotentSession(
      client,token,requestId,action,expectedVersion,key,pepper,
    ));
  }
}
