import {Injectable,UnauthorizedException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {
  listMyAccountSessions,revokeMyAccountSessionById,
  type AccountSessionSummary,
} from './account-session-management.js';
import {revokeCurrentAccountSession} from './session-revocation.js';
import {resolveActiveUserSession} from './session-proof.js';

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

  /** Authenticated remote-session revocation. Unknown/foreign targets are
   * indistinguishable; only a valid current bearer can invoke it. */
  async revokeSession(token:string,targetId:string):Promise<void>{
    const pepper=this.getPepper();
    await this.db.transaction(async client=>{
      const actor=await resolveActiveUserSession(client,token,pepper);
      if(!actor)throw new UnauthorizedException('Authentication required');
      // Ownership and active session state are enforced again in SQL.
      // Do not leak whether a foreign or unknown UUID exists.
      await revokeMyAccountSessionById(client,token,pepper,targetId);
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
