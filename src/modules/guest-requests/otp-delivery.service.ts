import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {normalizeGuestContact,type ContactChannel} from './guest-request.security.js';
import {
  DisabledOtpDelivery,OtpDeliveryUnavailable,
  validateOtpDeliveryMessage,sanitizeOtpDeliveryReceipt,
  type OtpDeliveryPort,type OtpDeliveryReceipt,
} from './otp-delivery.port.js';

export type VerifiedOtpIssuance = Readonly<{
  /** Plain code is in-memory only and never returned through HTTP. */
  code:string;
  channel:ContactChannel;
  contact:string;
  locale:'kk'|'ru';
  purpose?:'CREATE_REQUEST'|'MANAGE_SCHEDULE'|'COMPLETE_REQUEST';
  expiresInSeconds:number;
}>;

/**
 * Internal bridge for a verified, durable issuance record. Caller owns
 * challenge commit, per-recipient/network/global budget, generic HTTP response
 * and delivery failure reconciliation. No implicit default provider.
 */
@Injectable()
export class OtpDeliveryService {
  constructor(
    private readonly provider:OtpDeliveryPort=new DisabledOtpDelivery(),
    private readonly deadlineMs=5_000,
  ){}

  /** Startup guard only: does not verify external delivery or provider approval. */
  isProviderAttached():boolean{
    return !(this.provider instanceof DisabledOtpDelivery);
  }

  async deliverCommittedChallenge(issuance:VerifiedOtpIssuance):Promise<OtpDeliveryReceipt>{
    let message;
    try {
      message=validateOtpDeliveryMessage({
        channel:issuance.channel,
        destination:normalizeGuestContact(issuance.channel,issuance.contact),
        code:issuance.code,
        purpose:issuance.purpose??'CREATE_REQUEST',
        expiresInSeconds:issuance.expiresInSeconds,
        locale:issuance.locale,
      });
    }catch{
      throw new ServiceUnavailableException('OTP delivery temporarily unavailable');
    }
    // Bound provider wait time independently of the Next/Nest HTTP timeout.
    // Dispatch revokes the already committed OTP challenge on any rejection.
    // An adapter must also honor AbortSignal in its own transport so that
    // a late provider acknowledgement cannot be treated as authorization.
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      if(!Number.isSafeInteger(this.deadlineMs)||this.deadlineMs<1||
         this.deadlineMs>30_000)throw new OtpDeliveryUnavailable();
      const deadline=new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>{
          controller.abort();
          reject(new OtpDeliveryUnavailable());
        },this.deadlineMs);
        timer.unref?.();
      });
      const result=await Promise.race([
        Promise.resolve().then(()=>this.provider.deliverOtp(message,controller.signal)),
        deadline,
      ]);
      const safe=sanitizeOtpDeliveryReceipt(result);
      if(!safe.accepted)throw new OtpDeliveryUnavailable();
      return safe;
    }catch{
      controller.abort();
      // Never log provider errors; may contain raw recipients, payloads or auth.
      throw new ServiceUnavailableException('OTP delivery temporarily unavailable');
    }finally{
      if(timer!==undefined)clearTimeout(timer);
    }
  }
}
