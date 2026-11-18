import {Inject,Injectable,UnauthorizedException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {extractAdminBearerToken} from './admin-bearer-proof.js';
import {readProfessionalAppealAudit} from './admin-professional-appeal-audit-read.js';

/** Internal prepared GET only, default-off, no production module registration. */
@Injectable()
export class PlatformProfessionalAppealAuditReadService{
 constructor(@Inject(DatabasePool) private readonly db:DatabasePool){}
 read(authorization:unknown,appealId:unknown,profileId:unknown){
  if(process.env.SERVICES_ENABLE_PLATFORM_APPEAL_AUDIT_READ_HTTP!=='enabled')
   throw new UnauthorizedException('Authentication required');
  const token=extractAdminBearerToken(authorization);
  if(!token)throw new UnauthorizedException('Authentication required');
  let pepper:Buffer;
  try{pepper=requireSecret(process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY);}
  catch{throw new UnauthorizedException('Authentication required');}
  return this.db.transaction(client=>readProfessionalAppealAudit(client,token,pepper,appealId,profileId));
 }
}
