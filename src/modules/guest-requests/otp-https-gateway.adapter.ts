import {isIP} from 'node:net';
import {
  sanitizeOtpDeliveryReceipt,validateOtpDeliveryMessage,
  type OtpDeliveryMessage,type OtpDeliveryPort,type OtpDeliveryReceipt,
} from './otp-delivery.port.js';

/**
 * Unwired HTTPS JSON delivery *adapter* for a future security-reviewed gateway.
 * The gateway must implement POST {channel,destination,code,purpose,locale,
 * expiresInSeconds} -> HTTP 202 JSON {accepted:true,providerRef:string}.
 *
 * NOT a deployed provider or a generic internet proxy. A production review
 * must approve the exact gateway host, KZ residency, provider authentication,
 * edge egress/IP restrictions and log redaction before DI wiring.
 */
export type OtpHttpsGatewayOptions=Readonly<{
  endpoint:string;
  approvedHost:string;
  apiToken:string;
  transport?:typeof fetch;
}>;

const LIMIT=512;
const HOST=/^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const ERROR='otp_gateway_unavailable';
function reject():never{throw new Error(ERROR);}

export class OtpHttpsGatewayAdapter implements OtpDeliveryPort {
  private readonly url:string;
  private readonly token:string;
  private readonly transport:typeof fetch;

  constructor(options:OtpHttpsGatewayOptions){
    let url:URL;
    try{url=new URL(options.endpoint);}catch{throw new Error(ERROR);}
    const hostname=url.hostname.toLowerCase();
    if(url.protocol!=='https:'||url.username||url.password||
       url.search||url.hash||(url.port&&url.port!=='443')||
       !HOST.test(hostname)||isIP(hostname)!==0||
       hostname.endsWith('.localhost')||hostname.endsWith('.local')||
       hostname.endsWith('.internal')||
       hostname!==options.approvedHost||
       !/^\/[a-zA-Z0-9/_-]{1,160}$/.test(url.pathname)||
       !url.pathname.startsWith('/v1/')||
       typeof options.apiToken!=='string'||
       !/^[A-Za-z0-9._~-]{32,256}$/.test(options.apiToken)||
       (options.transport!==undefined&&typeof options.transport!=='function'))
      throw new Error(ERROR);
    this.url=url.toString();
    this.token=options.apiToken;
    this.transport=options.transport??fetch;
  }

  async deliverOtp(message:OtpDeliveryMessage,signal?:AbortSignal):Promise<OtpDeliveryReceipt>{
    try{
      validateOtpDeliveryMessage(message);
      if(signal?.aborted)reject();
      // AbortSignal.any keeps both outer service cancellation and the
      // adapter's stricter three-second I/O deadline enforceable.
      const budget=AbortSignal.timeout(3_000);
      const combined=signal?AbortSignal.any([signal,budget]):budget;
      const response=await this.transport(this.url,{
        method:'POST',
        headers:{
          'content-type':'application/json',
          'accept':'application/json',
          'authorization':'Bearer '+this.token,
          'cache-control':'no-store',
        },
        body:JSON.stringify(message),
        redirect:'error',credentials:'omit',signal:combined,
      });
      if(response.status!==202||!response.ok||
         !/^application\/json(?:\s*;|\s*$)/i.test(
          response.headers.get('content-type')??'')||
         /(?:^|,)\s*(?:public|s-maxage\s*=)/i.test(
          response.headers.get('cache-control')??'')||
         !response.body)reject();
      const length=response.headers.get('content-length');
      if(length!==null&&(!/^[0-9]{1,4}$/.test(length)||Number(length)>LIMIT))
        reject();
      const reader=response.body.getReader();
      let size=0;
      const parts:Uint8Array[]=[];
      let ended=false;
      try{
        for(;;){
          const chunk=await reader.read();
          if(chunk.done){ended=true;break;}
          if(!(chunk.value instanceof Uint8Array)||
             size+chunk.value.byteLength>LIMIT)reject();
          parts.push(chunk.value);size+=chunk.value.byteLength;
        }
      }finally{
        if(!ended)try{void reader.cancel().catch(()=>{});}catch{}
        reader.releaseLock();
      }
      const bytes=new Uint8Array(size);
      let offset=0;
      for(const part of parts){bytes.set(part,offset);offset+=part.length;}
      const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      const parsed:unknown=JSON.parse(decoded);
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
         Object.getPrototypeOf(parsed)!==Object.prototype||
         Object.keys(parsed).sort().join(',')!=='accepted,providerRef')
        reject();
      const receipt=sanitizeOtpDeliveryReceipt(parsed);
      if(!receipt.accepted||!receipt.providerRef)reject();
      return receipt;
    }catch{
      // Never expose gateway errors, response body, phone/email or OTP.
      return reject();
    }
  }
}
