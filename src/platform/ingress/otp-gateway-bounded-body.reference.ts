/**
 * Unwired reference for a future OTP gateway streaming body boundary.
 * A caller-owned AbortSignal (e.g. AbortSignal.timeout) promptly rejects
 * even while an iterator's next() is stalled. The transport MUST still
 * cancel/destroy its actual socket: this helper cannot stop rogue sources.
 * Socket/header deadlines, TLS/mTLS and deployment remain external duties.
 */
export async function readBoundedOtpGatewayBody(
  source:AsyncIterable<Buffer>,
  signal?:AbortSignal,
):Promise<Buffer>{
  const reject=():never=>{throw new Error('otp_gateway_request_rejected');};
  if(!source||typeof source[Symbol.asyncIterator]!=='function'||signal?.aborted)
    reject();
  const chunks:Buffer[]=[];
  let total=0;
  const iterator=source[Symbol.asyncIterator]();
  let finished=false;
  try{
    while(true){
      if(signal?.aborted)reject();
      let removeAbort:()=>void=()=>{};
      const pending=Promise.resolve().then(()=>iterator.next());
      const next=signal?await Promise.race([
        pending,
        new Promise<IteratorResult<Buffer>>((_,deny)=>{
          const onAbort=()=>deny(new Error('otp_gateway_request_rejected'));
          signal.addEventListener('abort',onAbort,{once:true});
          removeAbort=()=>signal.removeEventListener('abort',onAbort);
          if(signal.aborted)onAbort();
        }),
      ]).finally(()=>removeAbort()):await pending;
      if(signal?.aborted)reject();
      if(next.done){finished=true;break;}
      const chunk=next.value;
      if(!Buffer.isBuffer(chunk)||chunk.length>1024-total)reject();
      total+=chunk.length;
      chunks.push(Buffer.from(chunk));
    }
    if(total===0||signal?.aborted)reject();
    return Buffer.concat(chunks,total);
  }catch{
    return reject();
  }finally{
    if(!finished&&typeof iterator.return==='function'){
      // Cleanup is best-effort: malformed chunks, overflow, and cancellation
      // must never wait for a stalled or malicious iterator.return().
      try{
        void Promise.resolve(iterator.return()).catch(()=>{});
      }catch{/* preserve the original fail-closed error */}
    }
  }
}
