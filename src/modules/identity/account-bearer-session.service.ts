import {Injectable,UnauthorizedException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {
  listMyAccountSessions,type AccountSessionSummary,
} from './account-session-management.js';
import {revokeCurrentAccountSession} from './session-revocation.js';

/**
 * Bearer-only transport integration. This is not a login issuer.
 * All reads and writes verify live ACTIVE session in one DB transaction.
 * Browser cookie authentication belongs in the separately CSRF-protected BFF.
 */
@Injectable()
export class AccountBearerSessionService{
  constructor(private readonly db:DatabasePool){}

  private getPepper():Buffer{
    return requireSecret(process.env.ACCOUNT_SESSION_HMAC_KEY);
  }

  async list(token:string):Promise<{items:AccountSessionSummary[]}>{
    const pepper=this.getPepper();
    return this.db.transaction(async client=>{
      const items=await listMyAccountSessions(client,token,pepper);
      if(items===null)throw new UnauthorizedException('Authentication required');
      return {items};
    });
  }

  async logout(token:string):Promise<void>{
    const pepper=this.getPepper();
    await this.db.transaction(async client=>{
      const revoked=await revokeCurrentAccountSession(client,token,pepper);
      if(!revoked)throw new UnauthorizedException('Authentication required');
    });
  }
}
