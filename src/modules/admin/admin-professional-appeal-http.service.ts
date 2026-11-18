import {Inject,Injectable,UnauthorizedException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {extractAdminBearerToken} from './admin-bearer-proof.js';
import {assignProfessionalAppealReviewer} from './admin-professional-appeal-assignment.js';
import {decideProfessionalAppeal} from './admin-professional-appeal-decision.js';

/** Prepared only: NO module registration; both HTTP operations default off. */
@Injectable()
export class PlatformProfessionalAppealAdminService{
 constructor(@Inject(DatabasePool) private readonly db:DatabasePool){}
 private authenticate(authorization:unknown,flag:string):{token:string;pepper:Buffer}{
  if(process.env[flag]!=='enabled')
   throw new UnauthorizedException('Authentication required');
  const token=extractAdminBearerToken(authorization);
  if(!token)throw new UnauthorizedException('Authentication required');
  let pepper:Buffer;
  try{pepper=requireSecret(process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY);}
  catch{throw new UnauthorizedException('Authentication required');}
  return {token,pepper};
 }
 assign(authorization:unknown,appealId:unknown,body:unknown){
  const {token,pepper}=this.authenticate(authorization,'SERVICES_ENABLE_PLATFORM_APPEAL_ASSIGN_HTTP');
  return this.db.transaction(client=>assignProfessionalAppealReviewer(client,token,pepper,appealId,body));
 }
 decide(authorization:unknown,appealId:unknown,body:unknown){
  const {token,pepper}=this.authenticate(authorization,'SERVICES_ENABLE_PLATFORM_APPEAL_DECIDE_HTTP');
  return this.db.transaction(client=>decideProfessionalAppeal(client,token,pepper,appealId,body));
 }
}
