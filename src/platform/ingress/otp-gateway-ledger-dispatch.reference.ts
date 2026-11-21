import {
  OtpGatewayPostgresLedger,
  type OtpGatewayClaim,
} from './otp-gateway-postgres-ledger.reference.js';

/**
 * Pure gateway orchestration reference; never import into browser/Nest HTTP.
 * Authentication of the upstream BFF, HMAC fingerprint verification against
 * the original JSON body, TLS/egress controls, and OTP vendor integration
 * MUST be implemented and approved by the actual gateway deployment.
 *
 * "In flight" includes ambiguous vendor outcomes. It MUST NOT be used as an
 * instruction to retry automatically, including after process restart.
 */
export type OtpGatewayDispatchInput=Readonly<{
  idempotencyKey:string;
  fingerprint:string;
}>;
export type OtpGatewayVendorPort=Readonly<{
  sendOnce:(signal?:AbortSignal)=>Promise<Readonly<{
    accepted:true;
    providerRef:string;
  }>>;
}>;
export type OtpGatewayDispatchResult=
  |Readonly<{status:'accepted';providerRef:string}>
  |Readonly<{status:'in_flight'}>
  |Readonly<{status:'conflict'}>;

const UNAVAILABLE='otp_gateway_delivery_unavailable';
function unavailable():never{throw new Error(UNAVAILABLE);}

export class OtpGatewayLedgerDispatchReference {
  constructor(
    private readonly ledger:Pick<OtpGatewayPostgresLedger,'claim'|'recordAccepted'>,
  ){}

  async dispatch(
    input:OtpGatewayDispatchInput,
    vendor:OtpGatewayVendorPort,
    signal?:AbortSignal,
  ):Promise<OtpGatewayDispatchResult>{
    if(!vendor||typeof vendor.sendOnce!=='function')unavailable();
    if(signal?.aborted)unavailable();
    let claim:OtpGatewayClaim;
    try{
      claim=await this.ledger.claim(input.idempotencyKey,input.fingerprint);
    }catch{return unavailable();}
    if(claim.decision==='conflict')return {status:'conflict'};
    if(claim.decision==='in_flight')return {status:'in_flight'};
    if(claim.decision==='accepted')
      return {status:'accepted',providerRef:claim.providerRef};

    // The reservation is already durable; if the caller disconnects before
    // delivery, leave it unresolved for manual/vendor-side reconciliation.
    // It is not safe to release and retry after an uncertain send.
    if(signal?.aborted)unavailable();
    try{
      const outcome=await vendor.sendOnce(signal);
      if(signal?.aborted||!outcome||outcome.accepted!==true||
         typeof outcome.providerRef!=='string')
        unavailable();
      const saved=await this.ledger.recordAccepted(
        input.idempotencyKey,input.fingerprint,outcome.providerRef,
      );
      if(!saved)unavailable();
      return {status:'accepted',providerRef:outcome.providerRef};
    }catch{
      // Never return provider error contents or retry an uncertain delivery.
      return unavailable();
    }
  }
}
