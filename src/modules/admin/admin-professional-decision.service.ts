import {Inject,Injectable,UnauthorizedException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {extractAdminBearerToken} from './admin-bearer-proof.js';
import {decideProfessionalModerationCase} from './admin-professional-decision.js';

/** Disabled by default; intended only for privileged server-to-server clients. */
@Injectable()
export class PlatformProfessionalDecisionService{
 constructor(@Inject(DatabasePool) private readonly db:DatabasePool){}
 async decide(authorization:unknown,caseId:unknown,body:unknown){
  if(process.env.SERVICES_ENABLE_PLATFORM_MODERATION_DECIDE_HTTP!=='enabled')
   throw new UnauthorizedException('Authentication required');
  const token=extractAdminBearerToken(authorization);
  if(!token)throw new UnauthorizedException('Authentication required');
  let pepper:Buffer;
  try{pepper=requireSecret(process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY);}
  catch{throw new UnauthorizedException('Authentication required');}
  return this.db.transaction(client=>decideProfessionalModerationCase(client,token,pepper,caseId,body));
 }
}
