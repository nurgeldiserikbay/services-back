import {createHmac,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';

/**
 * Reference ONLY for a separately deployed, controlled edge signer.
 *
 * Callers MUST obtain clientAddress from the ingress-controlled socket/client
 * address resolver, never from Forwarded, X-Forwarded-For or a browser header.
 * This function does not perform proxy authentication, TLS termination or
 * inbound header stripping. Do NOT import it into Nest HTTP controllers or
 * browser/frontend code; production approval must verify the deployment.
 */
export function makeTrustedOtpNetworkProof(
  clientAddress:unknown,
  identityKey:Buffer,
  attestationKey:Buffer,
  now=Date.now(),
):string{
  if(typeof clientAddress!=='string'||clientAddress.length>64||
     ![4,6].includes(isIP(clientAddress))||
     !Buffer.isBuffer(identityKey)||identityKey.length!==32||
     !Buffer.isBuffer(attestationKey)||attestationKey.length!==32||
     timingSafeEqual(identityKey,attestationKey)||
     !Number.isSafeInteger(now)||now<1_000_000_000_000||
     now>9_999_999_999_999)
    throw new Error('invalid_trusted_otp_edge_proof_input');

  // Normalize IPv6 representation to avoid treating equivalent textual
  // addresses as distinct quota subjects. The deployment must separately
  // specify IPv6 prefix aggregation policy if necessary.
  const family=isIP(clientAddress);
  const canonical=family===6
    ?new URL('http://['+clientAddress+']/').hostname.slice(1,-1)
    :clientAddress;
  // A dual-stack reverse proxy may supply the same IPv4 socket as an
  // IPv4-mapped IPv6 address. The quota identity must NOT change with that
  // transport representation; reject network-budget splitting by spelling.
  const mapped=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  const mappedIpv4=mapped
    ?[parseInt(mapped[1],16)>>8,parseInt(mapped[1],16)&255,
      parseInt(mapped[2],16)>>8,parseInt(mapped[2],16)&255].join('.')
    :null;
  const normalizedFamily=mappedIpv4?'4':String(family);
  const normalizedAddress=mappedIpv4??canonical;
  const digest=createHmac('sha256',identityKey)
    .update('services-otp-client-network:v1\n')
    .update(normalizedFamily).update('\n')
    .update(normalizedAddress).digest('hex');
  const timestamp=String(now);
  const mac=createHmac('sha256',attestationKey)
    .update('services-otp-network:v1\n')
    .update(digest).update('\n').update(timestamp).digest('hex');
  // Neither plaintext client IP nor either signing secret is in the proof.
  return 'v1.'+digest+'.'+timestamp+'.'+mac;
}
