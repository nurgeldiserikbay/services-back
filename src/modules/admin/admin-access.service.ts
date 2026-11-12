import {Injectable,ForbiddenException,UnauthorizedException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {extractAdminBearerToken} from './admin-bearer-proof.js';
import {
 resolvePlatformAdminSession,
} from './admin-session-resolver.js';
import {
 canPerformAdminOperation,type AdminOperation,type VerifiedAdminPrincipal,
} from './admin-authorization.policy.js';

/**
 * Reusable server-side authorization service for future platform endpoints.
 * It does not mount a route, issue sessions, enroll MFA or accept role claims.
 */
@Injectable()
export class PlatformAdminAccessService{
 constructor(private readonly database:DatabasePool){}

 async requireOperation(
  authorization:unknown,operation:AdminOperation,resourceScope:string,
 ):Promise<VerifiedAdminPrincipal>{
  const token=extractAdminBearerToken(authorization);
  if(token===null)throw new UnauthorizedException('Authentication required');
  // Independent key: never reuse ACCOUNT_SESSION_HMAC_KEY.
  const pepper=requireSecret(process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY);
  const now=Date.now();
  return this.database.transaction(async client=>{
   const principal=await resolvePlatformAdminSession(client,token,pepper,now);
   if(!principal)throw new UnauthorizedException('Authentication required');
   if(!canPerformAdminOperation(principal,operation,resourceScope,now))
    throw new ForbiddenException('Insufficient permission');
   return principal;
  });
 }
}
