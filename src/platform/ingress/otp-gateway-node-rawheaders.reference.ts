/**
 * Node.js IncomingMessage.rawHeaders contains alternating original header
 * names and values (not the normalized/coalesced req.headers map).
 * This helper preserves the original case and multiplicity; the downstream
 * OTP stream preflight and HMAC boundary MUST validate the resulting tuples.
 * Reference-only: no HTTP listener is deployed by importing this module.
 */
export function otpNodeRawHeaderPairs(
  rawHeaders:readonly string[],
):readonly (readonly [string,string])[]{
  const reject=():never=>{throw new Error('otp_gateway_request_rejected');};
  if(!Array.isArray(rawHeaders)||rawHeaders.length===0||
     rawHeaders.length>64||rawHeaders.length%2!==0)reject();
  const pairs:[string,string][]=[];
  for(let index=0;index<rawHeaders.length;index+=2){
    const name=rawHeaders[index];
    const value=rawHeaders[index+1];
    if(typeof name!=='string'||typeof value!=='string'||
       !/^[A-Za-z0-9!#$%&'*+.^_\x60|~-]+$/.test(name)||
       /[\r\n]/.test(value)||value.length>1024)reject();
    pairs.push([name,value]);
  }
  return pairs;
}
