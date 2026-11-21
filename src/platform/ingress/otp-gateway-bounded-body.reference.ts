/**
 * Unwired reference for a future OTP gateway's streaming HTTP body boundary.
 * Reject an oversized chunk BEFORE copying it into the accumulated buffer.
 * The caller MUST separately apply a socket/stream deadline, request timeout,
 * transport-level header limits and verifyTrustedOtpGatewayHttpEnvelope.
 * This helper is NOT a deployed HTTP server or a substitute for mTLS.
 */
export async function readBoundedOtpGatewayBody(
  source:AsyncIterable<Buffer>,
  signal?:AbortSignal,
):Promise<Buffer>{
  const reject=():never=>{throw new Error('otp_gateway_request_rejected');};
  if(!source||typeof source[Symbol.asyncIterator]!=='function')reject();
  const chunks:Buffer[]=[];
  let total=0;
  try{
    if(signal?.aborted)reject();
    for await(const chunk of source){
      if(signal?.aborted||!Buffer.isBuffer(chunk))reject();
      // Check length before retaining or copying the incoming chunk.
      if(chunk.length>1024-total)reject();
      total+=chunk.length;
      chunks.push(Buffer.from(chunk));
    }
    if(signal?.aborted||total===0)reject();
    return Buffer.concat(chunks,total);
  }catch{return reject();}
}
