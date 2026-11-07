import {
  AccountOtpDeliveryUnavailable,
  type AccountOtpDeliveryPort,
  type AccountOtpDispatchMessage,
  type AccountOtpDispatchReceipt,
} from './account-otp-delivery.port.js';

/**
 * Bound how long private account OTP dispatch waits for provider acceptance.
 * Timing out does NOT prove the provider never sent the message. Its challenge
 * must be revoked by the caller, and a late response is never accepted.
 *
 * Provider integrations should also configure their OWN network timeouts;
 * this promise deadline cannot cancel external IO by itself.
 */
export async function deliverAccountOtpWithinDeadline(
  provider:AccountOtpDeliveryPort,
  message:AccountOtpDispatchMessage,
  deadlineMs=8000,
):Promise<AccountOtpDispatchReceipt>{
  if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>8000)
    throw new AccountOtpDeliveryUnavailable();
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
    return await Promise.race([
      Promise.resolve().then(()=>provider.deliver(message)),
      new Promise<never>((_resolve,reject)=>{
        timeout=setTimeout(()=>reject(new AccountOtpDeliveryUnavailable()),deadlineMs);
      }),
    ]);
  }finally{
    if(timeout!==undefined)clearTimeout(timeout);
  }
}
