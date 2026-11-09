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
  purpose?:'CREATE_REQUEST'|'MANAGE_SCHEDULE';
  expiresInSeconds:number;
}>;

/**
 * Internal bridge for a verified, durable issuance record. Caller owns
 * challenge commit, per-recipient/network/global budget, generic HTTP response
 * and delivery failure reconciliation. No implicit default provider.
 */
@Injectable()
export class OtpDeliveryService {
  constructor(private readonly provider:OtpDeliveryPort=new DisabledOtpDelivery()){}

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
    try {
      const result=await this.provider.deliverOtp(message);
      const safe=sanitizeOtpDeliveryReceipt(result);
      if(!safe.accepted) throw new OtpDeliveryUnavailable();
      return safe;
    }catch{
      // Never log provider errors; may contain raw recipients, payloads or auth.
      throw new ServiceUnavailableException('OTP delivery temporarily unavailable');
    }
  }
}
