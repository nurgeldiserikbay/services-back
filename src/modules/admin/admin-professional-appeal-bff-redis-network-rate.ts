import {createHmac} from 'node:crypto';

const ROUTE=/^\/v1\/admin\/bff\/moderation\/appeals\/[^/]+\/(?:assignment|decision)(?:\/csrf)?\/?$/;
const WINDOW_MS=60_000;
const MAX_REQUESTS=20;
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
  const ip=request.socket?.remoteAddress;
  if(!redis||typeof redis.eval!=='function'||!Buffer.isBuffer(secret)||
   secret.length!==32||typeof ip!=='string'||ip.length<3||ip.length>64){
   reject(response,503);return;
  }
  const key='services:appeal-bff:net-rate:v1:'+
   createHmac('sha256',secret).update(ip).digest('hex');
  void Promise.resolve().then(()=>redis.eval(APPEAL_BFF_RATE_LUA,{
   keys:[key],arguments:[String(WINDOW_MS)],
  })).then(result=>{
   if(!Number.isSafeInteger(result)||typeof result!=='number'||result<1){
    reject(response,503);return;
   }
   if(result>MAX_REQUESTS){reject(response,429);return;}
   next();
  }).catch(()=>reject(response,503));
 };
}
