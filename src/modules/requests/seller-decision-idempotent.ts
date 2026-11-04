import {createHmac,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {resolveActiveUserSession} from '../identity/session-proof.js';
import {resolveSellerDecisionAuthority} from './seller-authority.js';
import {decideSellerRequest, SellerDecisionRejected,
  type DecisionResult,type SellerDecision} from './seller-decision.transaction.js';
import {UnauthorizedException} from '@nestjs/common';

type LedgerRow={
  request_hash:string;state:string;response_body:unknown;expires_at:Date;
};

function validateStoredReply(value:unknown):DecisionResult {
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new SellerDecisionRejected('conflict');
  const o=value as Record<string,unknown>;
  if(typeof o.id!=='string'||(o.state!=='accepted'&&o.state!=='declined')||
     typeof o.version!=='number'||!Number.isSafeInteger(o.version)||
     o.version<1||o.replayed!==false)
    throw new SellerDecisionRejected('conflict');
  return {id:o.id,state:o.state,version:o.version,replayed:true};
}

/**
 * Authenticating, checking seller ACL, transitioning and persisting a replayable
 * response MUST all happen under the caller's single PostgreSQL transaction.
 * The HMAC key is the configured, distinct 256-bit account session pepper.
 */
export async function decideWithIdempotentSession(
  client:Pick<PoolClient,'query'>,
  token:string,
  requestId:string,
  decision:SellerDecision,
  expectedVersion:number,
  key:string,
  pepper:Buffer,
):Promise<DecisionResult>{
  const session=await resolveActiveUserSession(client,token,pepper);
  if(!session)throw new UnauthorizedException('Authentication required');

  // Resource access is checked even on an idempotency replay. A revoked
  // organization member must not learn a previous decision afterward.
  const seller=await resolveSellerDecisionAuthority(client,session.userId,requestId);
  if(!seller.authorized)throw new SellerDecisionRejected('forbidden');

  const actorScope='seller:'+session.userId;
  const route='/requests/'+requestId+'/'+decision;
  const method='POST';
  const requestHash=createHmac('sha256',pepper)
    .update('seller-decision:v1\0')
    .update(JSON.stringify([requestId,decision,expectedVersion]))
    .digest('hex');

  // Same actor/key/route is serialized across different sessions/processes;
  // record uniqueness also prevents duplicate transitions.
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    [actorScope,route+':'+key],
  );
  const existing=await client.query<LedgerRow>(`
    SELECT request_hash,state,response_body,expires_at
    FROM idempotency_records
    WHERE actor_scope=$1 AND method=$2 AND route=$3 AND key=$4
    FOR UPDATE
  `,[actorScope,method,route,key]);
  const previous=existing.rows[0];
  if(previous){
    if(previous.request_hash!==requestHash||previous.state!=='COMPLETED'||
       previous.expires_at.getTime()<=Date.now())
      throw new SellerDecisionRejected('conflict');
    return validateStoredReply(previous.response_body);
  }

  const result=await decideSellerRequest(
    client,requestId,seller.seller,decision,expectedVersion,
  );
  await client.query(`
    INSERT INTO idempotency_records
      (id,actor_scope,method,route,key,request_hash,state,response_status,
       response_body,expires_at)
    VALUES($1::uuid,$2,$3,$4,$5,$6,'COMPLETED',200,$7::jsonb,
           now()+interval '24 hours')
  `,[
    randomUUID(),actorScope,method,route,key,requestHash,
    JSON.stringify({...result,replayed:false}),
  ]);
  return result;
}
