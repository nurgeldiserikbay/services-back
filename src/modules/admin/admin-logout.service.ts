import {Inject,Injectable,UnauthorizedException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {extractAdminBearerToken} from './admin-bearer-proof.js';
import {revokeOwnPlatformAdminSession} from './admin-session-revocation.js';

/** Exact bearer possession revokes only its own database session. */
@Injectable()
export class PlatformAdminLogoutService{
 constructor(@Inject(DatabasePool) private readonly db:DatabasePool){}
 async logout(authorization:unknown):Promise<void>{
  if(process.env.SERVICES_ENABLE_PLATFORM_ADMIN_LOGOUT_HTTP!=='enabled')
   throw new UnauthorizedException('Authentication required');
  const token=extractAdminBearerToken(authorization);
  if(!token)throw new UnauthorizedException('Authentication required');
  let pepper:Buffer;
  try{pepper=requireSecret(process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY);}
  catch{throw new UnauthorizedException('Authentication required');}
  try{
   await this.db.transaction(async client=>{
    await revokeOwnPlatformAdminSession(client,token,pepper);
   });
  }catch{throw new UnauthorizedException('Authentication required');}
 }
}
