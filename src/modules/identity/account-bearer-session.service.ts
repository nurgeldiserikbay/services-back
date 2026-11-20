import {Inject,Injectable,UnauthorizedException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {
  listMyAccountSessions,revokeMyAccountSessionById,
  type AccountSessionSummary,
} from './account-session-management.js';
import {revokeCurrentAccountSession} from './session-revocation.js';
import {resolveActiveUserSession} from './session-proof.js';
import {readAccountMe,type AccountMe} from './account-me.js';
import {confirmCustomerRequestCompletion,CustomerCompletionRejected,type CustomerCompletionResult} from '../requests/customer-completion.transaction.js';
import {ConflictException,NotFoundException} from '@nestjs/common';
import {publishOwnProfessionalProfile,type PublishReceipt} from './publish-professional-profile.js';
import {requestOwnProfileAppeal,type AppealReceipt} from './request-professional-profile-appeal.js';
import {findOwnAppealableProfileRejection,type AppealableProfileDecision} from './appealable-professional-profile-rejection.js';
import {readProfilePreview,type ProfilePreview} from './professional-profile-preview.js';
import {updateOwnProfessionalProfile} from './update-professional-profile.js';
import {createOwnProfessionalProfile} from './create-professional-profile.js';
import {listOwnProfessionalProfiles,type OwnProfessionalProfile} from './account-professional-profiles.js';

/**
 * Bearer-only transport integration. This is not a login issuer.
 * All reads and writes verify live ACTIVE session in one DB transaction.
 * Browser cookie authentication belongs in the separately CSRF-protected BFF.
 */
@Injectable()
export class AccountBearerSessionService{
  constructor(@Inject(DatabasePool) private readonly db:DatabasePool){}

  private getPepper():Buffer{
    return requireSecret(process.env.ACCOUNT_SESSION_HMAC_KEY);
  }

  async completeOwnRequest(token:string,requestId:string,expectedVersion:number):Promise<CustomerCompletionResult>{
    const pepper=this.getPepper();
    return this.db.transaction(async client=>{
      const actor=await readAccountMe(client,token,pepper);
      if(!actor)throw new UnauthorizedException('Authentication required');
      try{
        return await confirmCustomerRequestCompletion(
          client,requestId,actor.person_id,expectedVersion);
      }catch(error){
        if(error instanceof CustomerCompletionRejected){
          if(error.reason==='conflict')throw new ConflictException('Request state changed');
          // Conceal existence of another customer's request (IDOR defense).
          throw new NotFoundException('Request not found');
        }
        throw error;
      }
    });
  }

  async me(token:string):Promise<AccountMe>{
    const pepper=this.getPepper();
    return this.db.transaction(async client=>{
      const me=await readAccountMe(client,token,pepper);
      if(!me)throw new UnauthorizedException('Authentication required');
      return me;
    });
  }

  async publishProfessionalProfile(token:string,id:unknown,match:unknown,body:unknown):Promise<PublishReceipt>{
    const pepper=this.getPepper();
    return this.db.transaction(client=>publishOwnProfessionalProfile(client,token,pepper,id,match,body));
  }

  async appealableProfessionalRejection(token:string,id:unknown):Promise<AppealableProfileDecision|null>{
    const pepper=this.getPepper();
    return this.db.transaction(client=>findOwnAppealableProfileRejection(client,token,pepper,id));
  }

  async appealProfessionalProfile(token:string,id:unknown,match:unknown,body:unknown):Promise<AppealReceipt>{
    const pepper=this.getPepper();
    return this.db.transaction(client=>requestOwnProfileAppeal(client,token,pepper,id,match,body));
  }

  async previewProfessionalProfile(token:string,id:unknown):Promise<ProfilePreview>{
    const pepper=this.getPepper();
    return this.db.transaction(client=>readProfilePreview(client,token,pepper,id));
  }

  async updateProfessionalProfile(token:string,id:unknown,match:unknown,body:unknown):Promise<OwnProfessionalProfile>{
    const pepper=this.getPepper();
    return this.db.transaction(client=>updateOwnProfessionalProfile(client,token,pepper,id,match,body));
  }

  async createProfessionalProfile(token:string,body:unknown,key:unknown):Promise<OwnProfessionalProfile>{
    const pepper=this.getPepper();
    return this.db.transaction(client=>createOwnProfessionalProfile(client,token,pepper,body,key));
  }

  async professionalProfiles(token:string):Promise<OwnProfessionalProfile[]>{
    const pepper=this.getPepper();
    return this.db.transaction(async client=>{
      const profiles=await listOwnProfessionalProfiles(client,token,pepper);
      if(profiles===null)throw new UnauthorizedException('Authentication required');
      return profiles;
    });
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
