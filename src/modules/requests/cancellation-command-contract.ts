/**
 * Pure, unmounted cancellation HTTP input contract. This module parses
 * untrusted transport input only; it DOES NOT authenticate, authorize, route,
 * mutate state, or confer a seller/customer/guest capability.
 *
 * The caller must authenticate and enforce same-origin CSRF, then acquire a
 * durable PostgreSQL idempotency ledger entry (scope+method+route+key+body
 * hash), lock the request and invoke exactly one authorized transaction.
 */
export class CancellationCommandRejected extends Error {
  constructor(readonly reason:'invalid_request'|'missing_idempotency_key') {
    super('cancellation_command_rejected');
  }
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{16,128}$/;
export type CancellationCommand=Readonly<{
  requestId:string;
  expectedVersion:number;
  idempotencyKey:string;
}>;
/** Only {expectedVersion} may arrive in JSON; no principal/policy/actor flags. */
export function parseCancellationCommand(
  requestId:unknown,body:unknown,idempotencyKey:unknown,
):CancellationCommand {
  if(typeof idempotencyKey!=='string'||!KEY.test(idempotencyKey))
    throw new CancellationCommandRejected('missing_idempotency_key');
  if(typeof requestId!=='string'||!UUID.test(requestId)||
     !body||typeof body!=='object'||Array.isArray(body))
    throw new CancellationCommandRejected('invalid_request');
  const data=body as Record<string,unknown>;
  if(Object.keys(data).length!==1||
     !Object.hasOwn(data,'expectedVersion')||
     !Number.isSafeInteger(data.expectedVersion)||
     (data.expectedVersion as number)<1)
    throw new CancellationCommandRejected('invalid_request');
  return Object.freeze({
    requestId:requestId.toLowerCase(),
    expectedVersion:data.expectedVersion as number,
    idempotencyKey,
  });
}
/** Strict header values only; reject arrays and comma-joined multiple keys. */
export function parseCancellationIdempotencyHeader(
  header:unknown,
):string{
  if(typeof header!=='string'||!KEY.test(header))
    throw new CancellationCommandRejected('missing_idempotency_key');
  return header;
}
