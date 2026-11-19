import {createHash} from 'node:crypto';

/** Narrow Redis-compatible interface; the caller owns connection and TLS/auth. */
export type AppealBffReplayRedis=Readonly<{
 set:(key:string,value:string,options:{NX:true;PX:number})=>Promise<string|null>;
}>;

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST=/^[a-f0-9]{64}$/;
const MAX_TTL=600_000;

/**
 * Prepared shared-store implementation of the coordinator's one-use CSRF claim.
 * Redis SET NX PX is atomic across workers sharing the same durable Redis DB.
 * An unavailable Redis instance throws: never downgrade to an in-memory cache.
 * Not registered or enabled by a production module.
 */
export function createAppealBffRedisCsrfClaim(
 redis:AppealBffReplayRedis,
 now:()=>number=Date.now,
):(sessionId:string,proofDigest:string,expiresAt:number)=>Promise<boolean>{
 return async(sessionId,proofDigest,expiresAt)=>{
  const current=now();
  if(!redis||typeof redis.set!=='function'||
   typeof sessionId!=='string'||!UUID.test(sessionId)||
   typeof proofDigest!=='string'||!DIGEST.test(proofDigest)||
   !Number.isSafeInteger(current)||!Number.isSafeInteger(expiresAt)||
   expiresAt<=current||expiresAt-current>MAX_TTL)
   return false;
  // Do not expose session identifiers or browser CSRF tokens in Redis key logs.
  const key='services:appeal-bff:csrf:v1:'+
   createHash('sha256').update(sessionId.toLowerCase()+':'+proofDigest).digest('hex');
  // Redis TTL rounds to whole milliseconds. Keep the claim through the
  // entire token-validity boundary, including the millisecond of expiry.
  const result=await redis.set(key,'1',{NX:true,PX:expiresAt-current+1});
  if(result==='OK')return true;
  if(result===null)return false;
  throw new Error('Unexpected atomic CSRF claim response');
 };
}
