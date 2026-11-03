/**
 * OTP delivery port, not a concrete SMS/email provider.
 * Raw contact/code must NEVER be put in logs, analytics, queues or outbox
 * safe_payload. This adapter is invoked only after atomic recipient/network
 * quota approval and a committed challenge.
 */
export type OtpChannel = 'sms'|'email';
export type OtpPurpose = 'CREATE_REQUEST';
export type OtpDeliveryMessage = Readonly<{
  channel:OtpChannel;
  destination:string;
  code:string;
  purpose:OtpPurpose;
  expiresInSeconds:number;
  locale:'kk'|'ru';
}>;
export type OtpDeliveryReceipt=Readonly<{
  accepted:boolean;
  /** Opaque, sanitized reference; not a recipient, OTP or provider response. */
  providerRef:string|null;
}>;
export interface OtpDeliveryPort {
  deliverOtp(message:OtpDeliveryMessage):Promise<OtpDeliveryReceipt>;
}

export class OtpDeliveryUnavailable extends Error {
  constructor(){super('OTP delivery is not configured');}
}

/** Production wiring fails CLOSED until a security-reviewed provider is set. */
export class DisabledOtpDelivery implements OtpDeliveryPort {
  async deliverOtp(_message:OtpDeliveryMessage):Promise<OtpDeliveryReceipt>{
    throw new OtpDeliveryUnavailable();
  }
}

export function validateOtpDeliveryMessage(value:OtpDeliveryMessage):OtpDeliveryMessage {
  if(value.purpose!=='CREATE_REQUEST' ||
     !['kk','ru'].includes(value.locale) ||
     !Number.isSafeInteger(value.expiresInSeconds) ||
     value.expiresInSeconds<60 || value.expiresInSeconds>900 ||
     !/^[0-9]{6}$/.test(value.code))
    throw new Error('invalid_otp_message');
  if(value.channel==='sms') {
    if(!/^\+[1-9][0-9]{7,14}$/.test(value.destination))
      throw new Error('invalid_otp_destination');
  }else if(value.channel==='email'){
    if(value.destination.length>320 ||
       !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.destination))
      throw new Error('invalid_otp_destination');
  }else{
    throw new Error('invalid_otp_channel');
  }
  return value;
}

/** Do not expose provider metadata beyond a bounded opaque reference. */
export function sanitizeOtpDeliveryReceipt(
  raw:unknown,
):OtpDeliveryReceipt{
  if(!raw || typeof raw!=='object' || Array.isArray(raw))
    throw new Error('invalid_provider_receipt');
  const receipt=raw as Record<string,unknown>;
  if(receipt.accepted!==true && receipt.accepted!==false)
    throw new Error('invalid_provider_receipt');
  const ref=receipt.providerRef;
  if(ref!==null && (typeof ref!=='string' ||
     !/^[a-zA-Z0-9_-]{8,120}$/.test(ref)))
    throw new Error('invalid_provider_receipt');
  return {accepted:receipt.accepted,providerRef:ref};
}
