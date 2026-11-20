import type {OtpDeliveryService} from './otp-delivery.service.js';
import {requireSecret} from './guest-request.security.js';

/**
 * Fail before binding an HTTP listener if ANY guest OTP issuance route is
 * explicitly enabled without an injected delivery adapter.
 *
 * The default module intentionally wires DisabledOtpDelivery. A non-disabled
 * adapter is only a prerequisite, not proof of its security approval, delivery
 * quality, KZ residency, ingress protection or rollout readiness.
 */
export function assertGuestOtpHttpStartupReady(
  flags:Readonly<Record<string,string|undefined>>,
  resolveDelivery:()=>Pick<OtpDeliveryService,'isProviderAttached'>,
):void{
  const requiresProvider=[
    'SERVICES_ENABLE_GUEST_OTP_HTTP',
    'SERVICES_ENABLE_GUEST_SCHEDULE_HTTP',
    'SERVICES_ENABLE_GUEST_COMPLETION_HTTP',
  ].some(flag=>flags[flag]==='enabled');
  if(!requiresProvider)return;
  // Reject malformed or absent edge attestation key before opening a socket.
  // The key must come from the deployment secret store, NOT a browser header.
  // This establishes only format/availability, not edge access policy or custody.
  try{
    requireSecret(flags.GUEST_NETWORK_ATTESTATION_KEY);
  }catch{
    throw new Error('Guest OTP HTTP requires valid trusted ingress key');
  }
  // Never trust a declaration-only env flag as proof that an adapter exists.
  let attached=false;
  try{
    attached=resolveDelivery().isProviderAttached()===true;
  }catch{/* Reject absent or broken DI configuration without leaking secrets. */}
  if(!attached)throw new Error('Guest OTP HTTP requires configured delivery adapter');
}
