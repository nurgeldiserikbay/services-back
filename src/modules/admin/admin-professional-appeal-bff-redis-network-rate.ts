import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';

const ROUTE=/^\/v1\/admin\/bff\/moderation\/appeals\/[^/]+\/(?:assignment|decision)(?:\/csrf)?\/?$/;
const WINDOW_MS=60_000;
const MAX_REQUESTS=20;
const REDIS_DEADLINE_MS=3_000;
/** Atomic, worker-shared fixed-window limiter. Only the digest is stored. */
export const APPEAL_BFF_RATE_LUA=`
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
elseif redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return n
`;

export type AppealBffRateRedis=Readonly<{
 eval:(script:string,options:{keys:string[];arguments:string[]})=>Promise<unknown>;
}>;
type RequestLike={
 method?:string;originalUrl?:string;
 socket?:{remoteAddress?:string};
};
type ResponseLike={
 headersSent?:boolean;
 setHeader:(key:string,value:string)=>unknown;
 status:(status:number)=>{json:(body:unknown)=>unknown};
};
type Next=(error?:unknown)=>void;
/** Socket peers may be presented as IPv4 or IPv4-mapped IPv6 by Node. */
function canonicalSocketPeer(value:unknown):string|null{
 if(typeof value!=='string'||value.length>64)return null;
 if(isIP(value)===4)return value;
 if(isIP(value)!==6)return null;
 // WHATWG URL canonicalizes equivalent IPv6 spellings (compression, case,
 // leading zero groups and dotted IPv4 suffixes) to the same 128-bit address.
 // isIP checked the input first; remoteAddress is never a request header.
 const canonical=new URL('http://['+value+']/').hostname.slice(1,-1);
 const mapped=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
 if(mapped){
  const high=parseInt(mapped[1]!,16),low=parseInt(mapped[2]!,16);
  return [high>>>8,high&255,low>>>8,low&255].join('.');
 }
 return canonical;
}
function reject(response:ResponseLike,status:number):void{
 if(response.headersSent)return;
 response.setHeader('Cache-Control','private, no-store, max-age=0');
 response.setHeader('Pragma','no-cache');
 response.setHeader('X-Content-Type-Options','nosniff');
 response.setHeader('X-Robots-Tag','noindex, nofollow');
 response.setHeader('Referrer-Policy','no-referrer');
 if(status===429)response.setHeader('Retry-After','60');
 response.status(status).json({statusCode:status,message:
  status===429?'Too Many Requests':'Service Unavailable'});
}
/**
 * Prepared only: register before JSON decoding and before privileged adapters.
 * The source is the TCP socket peer, NEVER Host/X-Forwarded-For headers.
 * For reverse proxies, each trusted proxy hop must itself enforce a network
 * limit; this gate otherwise groups all clients behind the same proxy.
 * No Redis -> 503 (fail closed); never use an in-memory fallback.
 */
export function createAppealBffRedisNetworkRateMiddleware(
 redis:AppealBffRateRedis,secret:Buffer,
){
 return (request:RequestLike,response:ResponseLike,next:Next):void=>{
  const path=request.originalUrl?.split('?')[0]??'';
  if(request.method!=='POST'||!ROUTE.test(path)||
   process.env.SERVICES_ENABLE_PLATFORM_APPEAL_BFF_HTTP!=='enabled'){
   next();return;
  }
  const ip=canonicalSocketPeer(request.socket?.remoteAddress);
  if(!redis||typeof redis.eval!=='function'||!Buffer.isBuffer(secret)||
   secret.length!==32||ip===null){
   reject(response,503);return;
  }
  const key='services:appeal-bff:net-rate:v1:'+
   createHmac('sha256',secret).update(ip).digest('hex');
  // Bound time spent waiting on Redis: even a client that never settles
  // cannot leave a protected HTTP request open indefinitely. Late responses
  // never call next() after the timeout branch has denied the request.
  let deadline:ReturnType<typeof setTimeout>|undefined;
  const requestClaim=Promise.resolve().then(()=>redis.eval(APPEAL_BFF_RATE_LUA,{
   keys:[key],arguments:[String(WINDOW_MS)],
  }));
  const timeout=new Promise<never>((_resolve,rejectTimeout)=>{
   deadline=setTimeout(()=>rejectTimeout(new Error('Redis rate gate deadline')),REDIS_DEADLINE_MS);
  });
  void Promise.race([requestClaim,timeout]).then(result=>{
   if(!Number.isSafeInteger(result)||typeof result!=='number'||result<1){
    reject(response,503);return;
   }
   if(result>MAX_REQUESTS){reject(response,429);return;}
   next();
  }).catch(()=>reject(response,503)).finally(()=>{
   if(deadline!==undefined)clearTimeout(deadline);
  });
 };
}
