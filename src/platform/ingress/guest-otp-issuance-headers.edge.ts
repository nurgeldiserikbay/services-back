import {makeTrustedOtpNetworkProof} from './guest-otp-network-proof.edge.js';

type OtpIssuancePurpose='CREATE_REQUEST'|'MANAGE_SCHEDULE'|'COMPLETE_REQUEST';
type TrustedOtpIssuanceContext=Readonly<{
  purpose:OtpIssuancePurpose;
  /** Resolved exclusively from the approved, authenticated ingress socket path. */
  clientAddress:string;
  identityKey:Buffer;
  attestationKey:Buffer;
  /** Obtained server-side from a verified scoped HttpOnly READ_CANCEL session. */
  readCapability?:string;
  now?:number;
}>;

const TOKEN=/^[A-Za-z0-9_-]{43}$/;

/**
 * Reference for a controlled OTP-issuance edge/BFF hop, NOT an HTTP endpoint.
 *
 * Do not copy ANY inbound browser header to the internal service. Construct
 * the full upstream allowlist afresh from trusted context. In particular this
 * drops forged x-services-network-proof, guest-capability, authentication,
 * cookies, forwarded IPs, proxy metadata and ambiguous duplicate headers.
 *
 * A deployed edge must separately prove upstream BFF authenticity, resolve
 * client IP from vetted proxy hops, strip inbound headers and restrict Nest
 * connectivity. Supplying readCapability does NOT itself verify its scope.
 */
export function buildTrustedGuestOtpIssuanceHeaders(
  untrustedInbound:Headers,
  trusted:TrustedOtpIssuanceContext,
):Headers{
  if(!(untrustedInbound instanceof Headers)||!trusted||
     !['CREATE_REQUEST','MANAGE_SCHEDULE','COMPLETE_REQUEST'].includes(trusted.purpose))
    throw new Error('invalid_trusted_otp_header_context');
  const needsCapability=trusted.purpose!=='CREATE_REQUEST';
  if((needsCapability&&
      (typeof trusted.readCapability!=='string'||!TOKEN.test(trusted.readCapability)))||
     (!needsCapability&&trusted.readCapability!==undefined))
    throw new Error('invalid_trusted_otp_header_context');

  // No client header is referenced, merged or spread into the result.
  const proof=makeTrustedOtpNetworkProof(
    trusted.clientAddress,trusted.identityKey,trusted.attestationKey,trusted.now,
  );
  const headers=new Headers();
  headers.set('content-type','application/json');
  headers.set('x-services-network-proof',proof);
  if(needsCapability)headers.set('guest-capability',trusted.readCapability!);
  return headers;
}
