import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {hashGuestCapability} from '../guest-requests/guest-request.security.js';
import {deriveGuestCancellationIdempotency,parseCancellationCommand}
  from './cancellation-command-contract.js';
import {cancelVerifiedGuestRequest,GuestCancellationRejected,
  type GuestCancellationResult} from './guest-cancel.transaction.js';

type Database=Pick<PoolClient,'query'>;
type LedgerRow={
  request_hash:string;state:string;
  response_status:number|null;response_body:unknown;is_live:boolean;
};
const ROUTE=(requestId:string)=>'/v1/requests/'+requestId+'/cancel';

/**
 * INTERNAL ONLY. Caller owns BEGIN/COMMIT/ROLLBACK and supplies the verified
 * request-scoped READ_CANCEL proof, validated 256-bit pepper and an independent
 * 256-bit server HMAC key. Never mount this directly on an HTTP route.
 *
 * A valid, active capability must be reverified even for ledger replays.
 * Unique INSERT ... ON CONFLICT serializes concurrent attempts for the same
 * principal/request/key. The cancellation, outbox, two notification intents
 * and COMPLETED response are written in the SAME caller transaction.
 */
export async function cancelGuestRequestIdempotently(
  db:Database,requestId:string,readCancelProof:string,expectedVersion:number,
  idempotencyKey:string,pepper:Buffer,ledgerSecret:Buffer,
):Promise<GuestCancellationResult>{
  let cmd;
  try{
    cmd=parseCancellationCommand(requestId,{expectedVersion},idempotencyKey);
  }catch{
    throw new GuestCancellationRejected('unavailable');
  }
  if(typeof readCancelProof!=='string'||!Buffer.isBuffer(pepper)||
     pepper.length!==32||!Buffer.isBuffer(ledgerSecret)||
     ledgerSecret.length!==32)
    throw new GuestCancellationRejected('unavailable');
  let tokenHash:string;
  try{tokenHash=hashGuestCapability('READ_CANCEL',readCancelProof,pepper);}
  catch{throw new GuestCancellationRejected('unavailable');}
  // No durable ledger read, insertion, or replay can occur before a fresh
  // database proof check; browser-supplied contact IDs are never accepted.
  const proof=await db.query<{guest_contact_id:string}>(`
    SELECT c.guest_contact_id::text
    FROM guest_capabilities c
    JOIN guest_contacts g ON g.id=c.guest_contact_id
    JOIN service_requests r ON r.id=c.request_id
      AND r.guest_contact_id=c.guest_contact_id
    WHERE c.request_id=$1::uuid AND c.scope='READ_CANCEL'
      AND c.token_hash=$2 AND c.consumed_at IS NULL
      AND c.expires_at>now() AND g.verified_at IS NOT NULL
      AND g.expires_at>now()
    LIMIT 1
  `,[cmd.requestId,tokenHash]);
  const guestContactId=proof.rows[0]?.guest_contact_id;
  if(!guestContactId)throw new GuestCancellationRejected('unavailable');
  const {ledgerKey,bodyHash}=deriveGuestCancellationIdempotency({
    command:cmd,verifiedGuestContactId:guestContactId,
    serverSecret:ledgerSecret,
  });
  const actorScope='guest-cancel:'+ledgerKey;
  const route=ROUTE(cmd.requestId);
  // Never store the raw idempotency key or proof. This fixed key and scoped
  // opaque actor hash remain unique for each requested idempotency key.
  const created=await db.query<{id:string}>(`
    INSERT INTO idempotency_records
      (id,actor_scope,method,route,key,request_hash,state,expires_at)
    VALUES($1,$2,'POST',$3,'guest-cancel-v1',$4,'PROCESSING',
      now()+interval '1 day')
    ON CONFLICT (actor_scope,method,route,key) DO NOTHING
    RETURNING id::text
  `,[randomUUID(),actorScope,route,bodyHash]);
  if(!created.rows[0]){
    const existing=await db.query<LedgerRow>(`
      SELECT request_hash,state,response_status,response_body,
        expires_at>now() AS is_live
      FROM idempotency_records
      WHERE actor_scope=$1 AND method='POST'
        AND route=$2 AND key='guest-cancel-v1'
      FOR UPDATE
    `,[actorScope,route]);
    const saved=existing.rows[0];
    if(!saved||!saved.is_live||saved.request_hash!==bodyHash||
       saved.state!=='COMPLETED'||saved.response_status!==200||
       !saved.response_body||typeof saved.response_body!=='object')
      throw new GuestCancellationRejected('conflict');
    const result=saved.response_body as Record<string,unknown>;
    if(result.id!==cmd.requestId||result.state!=='cancelled_by_customer'||
       !Number.isSafeInteger(result.version)||
       (result.version as number)!==cmd.expectedVersion+1)
      throw new GuestCancellationRejected('conflict');
    // A stored success is not authority to report a stale state after any
    // later request mutation. Verify the authoritative row under a lock.
    const current=await db.query<{status:string;version:number}>(`
      SELECT status::text,version FROM service_requests
      WHERE id=$1::uuid FOR UPDATE
    `,[cmd.requestId]);
    if(current.rows.length!==1||
       current.rows[0].status!=='CANCELLED_BY_CUSTOMER'||
       current.rows[0].version!==result.version)
      throw new GuestCancellationRejected('conflict');
    return {id:cmd.requestId,state:'cancelled_by_customer',
      version:result.version as number};
  }
  const result=await cancelVerifiedGuestRequest(db,cmd.requestId,
    readCancelProof,cmd.expectedVersion,pepper);
  const completed=await db.query<{id:string}>(`
    UPDATE idempotency_records
    SET state='COMPLETED',response_status=200,response_body=$2::jsonb
    WHERE id=$1::uuid AND state='PROCESSING'
    RETURNING id::text
  `,[created.rows[0].id,JSON.stringify(result)]);
  if(completed.rows.length!==1)
    throw new GuestCancellationRejected('conflict');
  return result;
}
