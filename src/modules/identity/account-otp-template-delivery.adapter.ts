import {createHmac,timingSafeEqual} from 'node:crypto';
import {normalizeGuestContact} from '../guest-requests/guest-request.security.js';
import {
  AccountOtpDeliveryUnavailable,sanitizeAccountOtpReceipt,
  type AccountOtpDeliveryPort,type AccountOtpDispatchMessage,
  type AccountOtpDispatchReceipt,
} from './account-otp-delivery.port.js';
import {
  renderAccountOtpMessage,type AccountOtpRenderedMessage,
} from './account-otp-message-template.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A vendor implementation must use this opaque key to deduplicate delivery
 * attempts. Both the full message and the key are PRIVATE provider data.
 * Do not log either one. This is NOT a registered, live delivery provider.
 */
export type PrivateAccountOtpSend=(
  message:AccountOtpRenderedMessage,idempotencyKey:string,
)=>Promise<unknown>;

/**
 * Adapter boundary for a future approved SMS/email vendor.
 * It intentionally requires an explicitly injected sender and independent
 * 256-bit delivery key; no env-based auto-enable or default sender.
 */
export class AccountOtpTemplateDeliveryAdapter implements AccountOtpDeliveryPort{
  constructor(
    private readonly send:PrivateAccountOtpSend,
    private readonly deliveryKey:Buffer,
  ){
    if(typeof send!=='function'||!Buffer.isBuffer(deliveryKey)||
       deliveryKey.length!==32||
       timingSafeEqual(deliveryKey,Buffer.alloc(32)))
      throw new AccountOtpDeliveryUnavailable();
    this.deliveryKey=Buffer.from(deliveryKey);
  }

  async deliver(message:AccountOtpDispatchMessage):Promise<AccountOtpDispatchReceipt>{
    try{
      if(!message||typeof message.challengeId!=='string'||
         !UUID.test(message.challengeId))
        throw new AccountOtpDeliveryUnavailable();
      // Do not allow a future provider or caller to send to an unnormalized
      // or syntactically invalid email/phone number, even with a valid code.
      const normalized=normalizeGuestContact(
        message.channel==='EMAIL'?'email':'sms',message.destination);
      if(normalized!==message.destination)
        throw new AccountOtpDeliveryUnavailable();
      const rendered=renderAccountOtpMessage(message);
      const idempotencyKey=createHmac('sha256',this.deliveryKey)
        .update('services-account-otp-provider:v1\0')
        .update(message.challengeId.toLowerCase()).digest('base64url');
      const raw:unknown=await this.send(rendered,idempotencyKey);
      if(!raw||typeof raw!=='object'||Array.isArray(raw)||
         Object.keys(raw).sort().join(',')!=='accepted,providerRef')
        throw new AccountOtpDeliveryUnavailable();
      const receipt=sanitizeAccountOtpReceipt(raw);
      if(!receipt.accepted)throw new AccountOtpDeliveryUnavailable();
      return receipt;
    }catch{
      // Transport/provider errors can contain secrets or recipient addresses.
      // Only the generic error may cross the account dispatch boundary.
      throw new AccountOtpDeliveryUnavailable();
    }
  }
}
