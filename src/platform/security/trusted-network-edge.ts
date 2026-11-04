import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';

/**
 * Reference code for a SEPARATELY DEPLOYED, trusted ingress component.
 * Never call this using IP addresses or forwarding headers from HTTP request
 * bodies/headers. The ingress must first validate its peer/proxy chain.
 *
 * IPv4 buckets are /24 and IPv6 buckets are /64, policy defaults pending
 * review for carriers, NAT, rotating mobile addresses and IPv6 privacy.
 */
export function canonicalTrustedNetworkBucket(
  authenticatedClientAddress:string,
):string{
  if(typeof authenticatedClientAddress!=='string'||
    authenticatedClientAddress.length>100||
    authenticatedClientAddress!==authenticatedClientAddress.trim())
    throw new Error('invalid_trusted_network_address');
  const family=isIP(authenticatedClientAddress);
  if(family===4){
    const octets=authenticatedClientAddress.split('.');
    if(octets.length!==4||octets.some(o=>!/^(0|[1-9][0-9]{0,2})$/.test(o)||
       Number(o)>255))throw new Error('invalid_trusted_network_address');
    return 'v4:'+octets.slice(0,3).join('.')+'.0/24';
  }
  if(family===6){
    let canonical:string;
    try{
      canonical=new URL('http://['+authenticatedClientAddress+']/').hostname;
    }catch{throw new Error('invalid_trusted_network_address');}
    if(!canonical.startsWith('[')||!canonical.endsWith(']'))
      throw new Error('invalid_trusted_network_address');
    const ip=canonical.slice(1,-1);
    // IPv4-mapped addresses must be normalized by the ingress to IPv4
    // before this function, to prevent rotating equivalent quota buckets.
    if(ip.includes('.'))throw new Error('mapped_ipv4_requires_normalization');
    const sections=ip.split('::');
    if(sections.length>2)throw new Error('invalid_trusted_network_address');
    const left=sections[0]?sections[0].split(':'):[];
    const right=sections.length===2&&sections[1]?sections[1].split(':'):[];
    const fill=8-left.length-right.length;
    if((sections.length===1&&fill!==0)||
       (sections.length===2&&fill<1))
      throw new Error('invalid_trusted_network_address');
    const words=[...left,...Array(fill).fill('0'),...right];
    if(words.length!==8||words.some(w=>!/^[0-9a-f]{1,4}$/i.test(w)))
      throw new Error('invalid_trusted_network_address');
    return 'v6:'+words.slice(0,4).map(w=>w.toLowerCase().padStart(4,'0')).join(':')+'::/64';
  }
  throw new Error('invalid_trusted_network_address');
}

/**
 * Compatible with verifyTrustedNetworkProof in guest-network-quota.ts.
 * Keys have DISTINCT roles:
 *   digestKey: edge-only; makes stored bucket identifiers non-reversible.
 *   attestationKey: edge + backend; authenticates the short-lived assertion.
 */
export function signTrustedNetworkProof(input:{
  authenticatedClientAddress:string;
  digestKey:Buffer;
  attestationKey:Buffer;
  now?:number;
}):string{
  const {authenticatedClientAddress,digestKey,attestationKey}=input;
  const now=input.now??Date.now();
  if(!Buffer.isBuffer(digestKey)||digestKey.length!==32||
     !Buffer.isBuffer(attestationKey)||attestationKey.length!==32||
     !Number.isSafeInteger(now)||now<0||now>9999999999999||
     digestKey.equals(attestationKey))
    throw new Error('network_signer_unavailable');
  const bucket=canonicalTrustedNetworkBucket(authenticatedClientAddress);
  const digest=createHmac('sha256',digestKey)
    .update('services-otp-network-bucket:v1\n')
    .update(bucket).digest('hex');
  const stamp=String(now);
  const signature=createHmac('sha256',attestationKey)
    .update('services-otp-network:v1\n')
    .update(digest).update('\n').update(stamp).digest('hex');
  return 'v1.'+digest+'.'+stamp+'.'+signature;
}
