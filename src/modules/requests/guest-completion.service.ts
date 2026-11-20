import {ConflictException,Injectable,NotFoundException,
  ServiceUnavailableException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {confirmGuestRequestCompletion,GuestCompletionRejected}
 from './guest-completion.transaction.js';

@Injectable()
export class GuestCompletionService {
 constructor(private readonly db:DatabasePool){}
 async confirm(requestId:string,capability:string,expectedVersion:number):
  Promise<{id:string;state:'completed';version:number}>{
  let key:Buffer;
  try{key=requireSecret(process.env.GUEST_REQUEST_HMAC_KEY);}
  catch{throw new ServiceUnavailableException('Guest completion unavailable');}
  try{
   return await this.db.transaction(client=>
    confirmGuestRequestCompletion(client,requestId,capability,expectedVersion,key));
  }catch(e){
   if(e instanceof GuestCompletionRejected){
    if(e.reason==='conflict')throw new ConflictException('Request state changed');
    throw new NotFoundException('Request unavailable');
   }
   throw e;
  }
 }
}
