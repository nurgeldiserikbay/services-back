import type {PrivateAccountOtpDispatch} from './account-otp-issuance.js';

/** Account delivery is a separate, disabled-by-default integration. */
export type AccountOtpDispatchMessage=Readonly<PrivateAccountOtpDispatch&{
  locale:'kk'|'ru';
}>;
export type AccountOtpDispatchReceipt=Readonly<{
  accepted:boolean;
  providerRef:string|null;
}>;
export interface AccountOtpDeliveryPort {
  deliver(message:AccountOtpDispatchMessage):Promise<AccountOtpDispatchReceipt>;
}
export class AccountOtpDeliveryUnavailable extends Error {
  constructor(){super('Account OTP delivery unavailable');}
}
export class DisabledAccountOtpDelivery implements AccountOtpDeliveryPort {
  async deliver(_message:AccountOtpDispatchMessage):Promise<AccountOtpDispatchReceipt>{
    throw new AccountOtpDeliveryUnavailable();
  }
}
export function sanitizeAccountOtpReceipt(value:unknown):AccountOtpDispatchReceipt{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new AccountOtpDeliveryUnavailable();
  const raw=value as Record<string,unknown>;
  if(typeof raw.accepted!=='boolean'||
    !(raw.providerRef===null||typeof raw.providerRef==='string'&&
      /^[A-Za-z0-9_-]{8,120}$/.test(raw.providerRef)))
    throw new AccountOtpDeliveryUnavailable();
  return {accepted:raw.accepted,providerRef:raw.providerRef};
}
