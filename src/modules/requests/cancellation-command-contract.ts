/**
 * Pure, unmounted cancellation HTTP input contract. This module parses
 * untrusted transport input only; it DOES NOT authenticate, authorize, route,
 * mutate state, or confer a seller/customer/guest capability.
 *
 * The caller must authenticate and enforce same-origin CSRF, then acquire a
 * durable PostgreSQL idempotency ledger entry (scope+method+route+key+body
 * hash), lock the request and invoke exactly one authorized transaction.
 */
import {timingSafeEqual} from 'node:crypto';

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
  // Only a decoded JSON object is valid transport input. Reject class
  // instances and accessors: reading an untrusted getter can execute code,
  // and a prototype property must never supply the expected version.
  const prototype=Object.getPrototypeOf(data);
  if(prototype!==Object.prototype&&prototype!==null)
    throw new CancellationCommandRejected('invalid_request');
  const descriptor=Object.getOwnPropertyDescriptor(data,'expectedVersion');
  if(Object.keys(data).length!==1||!descriptor||
     !Object.hasOwn(descriptor,'value')||
     !Number.isSafeInteger(descriptor.value)||descriptor.value<1)
    throw new CancellationCommandRejected('invalid_request');
  return Object.freeze({
    requestId:requestId.toLowerCase(),
    expectedVersion:descriptor.value as number,
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

/**
 * Wire-level allowlist for a FUTURE HTTP adapter. Parsing JSON into an object
 * first silently erases duplicate properties, so validate the bounded UTF-8
 * body BEFORE JSON.parse. No request is authorized or mutated by this helper.
 * A JSON serializer can emit whitespace around the one allowed property,
 * but no duplicate keys, escaped aliases, arrays, floats or unknown fields.
 */
export function parseCancellationRawJsonBody(
  requestId:unknown,rawBody:unknown,idempotencyKey:unknown,
):CancellationCommand{
  if(typeof rawBody!=='string'||Buffer.byteLength(rawBody,'utf8')>128)
    throw new CancellationCommandRejected('invalid_request');
  const match=/^[ \t\r\n]*\{[ \t\r\n]*"expectedVersion"[ \t\r\n]*:[ \t\r\n]*([1-9][0-9]*)[ \t\r\n]*\}[ \t\r\n]*$/.exec(rawBody);
  if(!match||!Number.isSafeInteger(Number(match[1])))
    throw new CancellationCommandRejected('invalid_request');
  return parseCancellationCommand(requestId,{expectedVersion:Number(match[1])},
    idempotencyKey);
}

/**
 * Unmounted transport precondition for a future cancellation HTTP adapter.
 * expectedOrigin comes from trusted deployment configuration, NEVER a
 * request Host/X-Forwarded-Host header. requestProtocol must come from the
 * trusted proxy/TLS layer, NEVER untrusted X-Forwarded-Proto input.
 * This is NOT a replacement for session-bound CSRF or authorization.
 */
export function assertCancellationTransportHeaders(input:Readonly<{
  expectedOrigin:unknown;
  origin:unknown;
  fetchSite:unknown;
  contentType:unknown;
  requestProtocol:unknown;
}>):void{
  const fail=():never=>{throw new CancellationCommandRejected('invalid_request');};
  if(!input||typeof input!=='object'||
     typeof input.expectedOrigin!=='string'||input.expectedOrigin.length>255||
     typeof input.origin!=='string'||input.origin.length>255||
     input.fetchSite!=='same-origin'||input.requestProtocol!=='https:'||
     typeof input.contentType!=='string'||
     !/^application\/json(?:;\s*charset=utf-8)?$/i.test(input.contentType))
    fail();
  let expected:URL;
  try{expected=new URL(input.expectedOrigin as string);}
  catch{fail();return;}
  if(expected.protocol!=='https:'||expected.origin!==input.expectedOrigin||
     expected.username||expected.password||expected.pathname!=='/'||
     expected.search||expected.hash||input.origin!==expected.origin)
    fail();
}

/**
 * Verify a session-bound CSRF proof for a FUTURE cancellation adapter.
 * The expected token MUST come from an authenticated, server-verified
 * session (or an equivalent authenticated per-request server proof);
 * never derive it from a browser cookie/header or accept a public fixed key.
 * No identity or transaction is established by this pure function.
 */
export function assertCancellationSessionCsrf(
  submitted:unknown,sessionExpected:unknown,
):void{
  // Token strings are unpadded base64url representations of 32 random bytes.
  const token=/^[A-Za-z0-9_-]{43}$/;
  if(typeof submitted!=='string'||typeof sessionExpected!=='string'||
     !token.test(submitted)||!token.test(sessionExpected))
    throw new CancellationCommandRejected('invalid_request');
  // Avoid timing-sensitive native string equality for secret comparison.
  const a=Buffer.from(submitted,'base64url');
  const b=Buffer.from(sessionExpected,'base64url');
  if(a.length!==32||b.length!==32||
     !/^[A-Za-z0-9_-]{43}$/.test(a.toString('base64url'))||
     !/^[A-Za-z0-9_-]{43}$/.test(b.toString('base64url'))||
     !timingSafeEqual(a,b))
    throw new CancellationCommandRejected('invalid_request');
}
