import {Injectable,UnauthorizedException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {resolveActiveUserSession} from '../identity/session-proof.js';
import {readSellerInbox} from './seller-inbox.repository.js';
import {type SellerInboxFilter,type SellerInboxPage} from './seller-inbox.contract.js';

@Injectable()
export class SellerInboxService{
  constructor(private readonly db:DatabasePool){}

  async getOwnInbox(sessionToken:string,filter:SellerInboxFilter):Promise<SellerInboxPage>{
    const pepper=requireSecret(process.env.ACCOUNT_SESSION_HMAC_KEY);
    return this.db.transaction(async client=>{
      const session=await resolveActiveUserSession(client,sessionToken,pepper);
      if(!session)throw new UnauthorizedException('Authentication required');
      return readSellerInbox(client,session.userId,filter);
    });
  }
}
