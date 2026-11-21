import {createHmac,timingSafeEqual} from 'node:crypto';
import {validateOtpDeliveryMessage} from '../../modules/guest-requests/otp-delivery.port.js';
import {
  OtpGatewayLedgerDispatchReference,
  type OtpGatewayDispatchResult,
  type OtpGatewayVendorPort,
} from './otp-gateway-ledger-dispatch.reference.js';

/**
 * Not a server/listener. Reference-only gateway BFF authentication and
 * request-integrity boundary. A real gateway MUST also enforce private
 * network access, TLS/mTLS, maximum HTTP body bytes before buffering, an
 * exact route/method, source provenance, logging redaction and KZ residency.
 */
export type TrustedOtpGatewayIngressConfig=Readonly<{
  apiToken:string;
  idempotencySecret:Buffer;
}>;

export type VerifiedOtpGatewayPayload=Readonly<{
  channel:'sms'|'email';
  destination:string;
  code:string;
  purpose:'CREATE_REQUEST'|'MANAGE_SCHEDULE'|'COMPLETE_REQUEST';
  locale:'kk'|'ru';
  expiresInSeconds:number;
}>;

export type VerifiedOtpGatewayRequest=Readonly<{
  idempotencyKey:string;
  fingerprint:string;
  payload:VerifiedOtpGatewayPayload;
}>;

const FAIL='otp_gateway_request_rejected';
const HEX=/^[0-9a-f]{64}$/;
const API_TOKEN=/^[A-Za-z0-9._~-]{32,256}$/;
const EXPECTED_FIELDS=[
  'channel','code','destination','expiresInSeconds','locale','purpose',
];
function deny():never{throw new Error(FAIL);}
function equal(a:Buffer,b:Buffer):boolean{
  return a.length===b.length&&timingSafeEqual(a,b);
}

export function verifyTrustedOtpGatewayRequest(
  headers:Headers,
  rawBody:string,
  config:TrustedOtpGatewayIngressConfig,
):VerifiedOtpGatewayRequest{
  try{
    if(!(headers instanceof Headers)||
       typeof rawBody!=='string'||
       Buffer.byteLength(rawBody,'utf8')>1024||
       Buffer.byteLength(rawBody,'utf8')===0||
       !config||!API_TOKEN.test(config.apiToken)||
       !Buffer.isBuffer(config.idempotencySecret)||
       config.idempotencySecret.length!==32)deny();

    const auth=headers.get('authorization');
    const key=headers.get('idempotency-key');
    const supplied=headers.get('x-services-otp-payload-fingerprint');
    const contentType=headers.get('content-type');
    if(typeof auth!=='string'||!auth.startsWith('Bearer ')||
       typeof key!=='string'||!HEX.test(key)||
       typeof supplied!=='string'||!HEX.test(supplied)||
       contentType!=='application/json')deny();
    const providedToken=auth.slice('Bearer '.length);
    if(!API_TOKEN.test(providedToken)||
       !equal(Buffer.from(providedToken),Buffer.from(config.apiToken)))deny();

    const parsed:unknown=JSON.parse(rawBody);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
       Object.getPrototypeOf(parsed)!==Object.prototype)deny();
    const values=parsed as Record<string,unknown>;
    if(JSON.stringify(Object.keys(values).sort())!==JSON.stringify(EXPECTED_FIELDS))
      deny();
    // The upstream HTTPS adapter emits this exact JSON field order.
    // Disallow alternate serialized forms, duplicate properties, extra
    // fields, number notation changes or hidden whitespace so that the
    // digest refers to one and only one validated request body.
    const payload={
      channel:values.channel,destination:values.destination,
      code:values.code,purpose:values.purpose,locale:values.locale,
      expiresInSeconds:values.expiresInSeconds,
    };
    if(JSON.stringify(payload)!==rawBody)deny();
    if(!['sms','email'].includes(String(payload.channel))||
       !['CREATE_REQUEST','MANAGE_SCHEDULE','COMPLETE_REQUEST'].includes(
         String(payload.purpose))||
       !['kk','ru'].includes(String(payload.locale))||
       typeof payload.destination!=='string'||
       typeof payload.code!=='string'||
       typeof payload.expiresInSeconds!=='number')deny();
    validateOtpDeliveryMessage(payload as VerifiedOtpGatewayPayload);
    const expected=createHmac('sha256',config.idempotencySecret)
      .update('services-guest-otp-payload:v1\n')
      .update(key).update('\n')
      .update(rawBody).digest();
    if(!equal(expected,Buffer.from(supplied,'hex')))deny();

    return {
      idempotencyKey:key,
      fingerprint:supplied,
      payload:payload as VerifiedOtpGatewayPayload,
    };
  }catch{deny();}
}


/**
 * Transport adapter boundary for Node rawHeaders (header name/value pairs).
 * A Headers object has already coalesced duplicates, so a real gateway must
 * validate raw header multiplicity BEFORE converting to Headers.
 * This is a reference helper, not an HTTP listener or proxy trust decision.
 */
export function verifyTrustedOtpGatewayRawHeaders(
  rawHeaders:readonly (readonly [string,string])[],
  rawBody:string,
  config:TrustedOtpGatewayIngressConfig,
):VerifiedOtpGatewayRequest{
  if(!Array.isArray(rawHeaders)||rawHeaders.length>32)deny();
  const required=new Set([
    'authorization','idempotency-key',
    'x-services-otp-payload-fingerprint','content-type',
  ]);
  const counts=new Map<string,number>();
  const headers=new Headers();
  try{
    for(const entry of rawHeaders){
      if(!Array.isArray(entry)||entry.length!==2||
         typeof entry[0]!=='string'||typeof entry[1]!=='string')deny();
      const [name,value]=entry;
      if(!/^[A-Za-z0-9!#$%&'*+.^_\x60|~-]+$/.test(name)||
         value.length>1024||/[\r\n]/.test(value))deny();
      const lower=name.toLowerCase();
      if(lower==='content-encoding'||lower==='transfer-encoding')deny();
      const next=(counts.get(lower)??0)+1;
      if(next>1&&required.has(lower))deny();
      counts.set(lower,next);
      headers.append(name,value);
    }
    for(const name of required)if(counts.get(name)!==1)deny();
    return verifyTrustedOtpGatewayRequest(headers,rawBody,config);
  }catch{deny();}
}

/** Authenticate, validate and bind the inbound payload BEFORE ledger claim.
 * A gateway implementation constructs its approved vendor port exclusively
 * from the returned parsed payload; no browser-controlled vendor function.
 */
export async function dispatchVerifiedOtpGatewayRequest(
  headers:Headers,
  rawBody:string,
  config:TrustedOtpGatewayIngressConfig,
  gateway:OtpGatewayLedgerDispatchReference,
  makeVendor:(payload:VerifiedOtpGatewayPayload)=>OtpGatewayVendorPort,
  signal?:AbortSignal,
):Promise<OtpGatewayDispatchResult>{
  const request=verifyTrustedOtpGatewayRequest(headers,rawBody,config);
  if(signal?.aborted)deny();
  const vendor=makeVendor(request.payload);
  return gateway.dispatch({
    idempotencyKey:request.idempotencyKey,
    fingerprint:request.fingerprint,
  },vendor,signal);
}
