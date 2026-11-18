import {createHmac,timingSafeEqual} from 'node:crypto';
import {parseCancellationRawJsonBody,type CancellationCommand}
  from './cancellation-command-contract.js';

/**
 * Internal BFF assertion, not browser authentication. The BFF may sign only
 * after opening its request-scoped sealed session and checking CSRF/Origin.
 * The backend must still verify the capability and state in PostgreSQL.
 * An independent shared key and private TLS ingress are required.
 */
export function verifyGuestCancelBffAttestation(input:Readonly<{
  requestId:unknown;rawBody:unknown;idempotencyKey:unknown;
  capability:unknown;attestation:unknown;
}>,secret:Buffer,now=Date.now()):CancellationCommand|null{
  try{
    if(!Buffer.isBuffer(secret)||secret.length!==32||
       !Number.isSafeInteger(now)||now<0||
       typeof input.capability!=='string'||
       !/^[A-Za-z0-9_-]{43}$/.test(input.capability)||
       Buffer.from(input.capability,'base64url').toString('base64url')!==input.capability||
       typeof input.attestation!=='string'||input.attestation.length>100)
      return null;
    const match=/^v1\.([0-9]{13})\.([0-9a-f]{64})$/.exec(input.attestation);
    if(!match||Math.abs(now-Number(match[1]))>30000)return null;
    const command=parseCancellationRawJsonBody(input.requestId,input.rawBody,
      input.idempotencyKey);
    // Fixed-order JSON tuple avoids delimiter ambiguity. Bind the exact body,
    // route, method, capability and idempotency key to the short-lived proof.
    const payload=JSON.stringify(['services-guest-cancel-bff:v1',match[1],
      'POST','/v1/requests/'+command.requestId+'/cancel',
      input.rawBody,command.idempotencyKey,input.capability]);
    const expected=createHmac('sha256',secret).update(payload,'utf8').digest();
    const actual=Buffer.from(match[2],'hex');
    return timingSafeEqual(actual,expected)?command:null;
  }catch{return null;}
}
