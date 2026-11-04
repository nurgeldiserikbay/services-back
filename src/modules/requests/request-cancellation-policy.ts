/**
 * Pure cancellation classification. Authentication, row-locking, idempotency,
 * outbox/notification persistence and reliable delivery belong to a future
 * transaction service. This module must never mutate state on its own.
 *
 * Important: a preferred time is not an accepted schedule. A penalty can be
 * calculated only from the immutable, accepted-time cancellation snapshot.
 */
export type CancellationSide='customer'|'provider';
export type RequestCancellationState=
  'PENDING'|'ACCEPTED'|'DECLINED'|'COMPLETED'|'EXPIRED'|
  'CANCELLED_BY_CUSTOMER'|'CANCELLED_BY_PROVIDER'|'CANCELLED_MUTUAL';

export type CancellationPolicySnapshot=Readonly<{
  scheduledStartAt:Date;
  freeCancelUntil:Date;
  acceptedAt:Date;
  policyRevision:number;
  timezone:string;
}>;

export type CancellationContext=Readonly<{
  state:RequestCancellationState;
  actor:CancellationSide;
  now:Date;
  /** A registered customer may receive a proposed reliability event. */
  customerPersonId:string|null;
  /** Exactly one of these is set for the original seller context. */
  sellerProfessionalId:string|null;
  sellerOrganizationId:string|null;
  /** Not a confirmed schedule and not a substitute for a snapshot. */
  snapshot:CancellationPolicySnapshot|null;
  customerPenaltySuspended:boolean;
  scheduleReconciliationRequired:boolean;
}>;

export type ProposedReliability=
  | Readonly<{subject:'CUSTOMER';targetId:string;reason:'LATE_CUSTOMER_CANCELLATION'}>
  | Readonly<{subject:'PROFESSIONAL';targetId:string;reason:'PROVIDER_CANCELLATION'}>
  | Readonly<{subject:'ORGANIZATION';targetId:string;reason:'PROVIDER_CANCELLATION'}>;

export type CancellationClassification=Readonly<{
  nextState:'CANCELLED_BY_CUSTOMER'|'CANCELLED_BY_PROVIDER';
  actor:'CUSTOMER'|'SELLER';
  /** A late cancellation flag describes policy timing, not automatic fines. */
  isLate:boolean;
  reliability:ProposedReliability|null;
  /** A transaction must persist both intents, including PENDING cancels. */
  requiredAudiences:readonly ['INITIATOR','COUNTERPARTY'];
}>;

export class CancellationPolicyRejected extends Error{
  constructor(readonly reason:'invalid_context'|'conflict'|'schedule_reconciliation'){
    super(reason);
  }
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validDate(d:unknown):d is Date{
  return d instanceof Date&&Number.isFinite(d.getTime());
}
function validId(id:string|null):boolean{
  return id===null||(typeof id==='string'&&UUID.test(id));
}
function validSnapshot(snapshot:CancellationPolicySnapshot|null):boolean{
  if(snapshot===null)return true;
  return validDate(snapshot.acceptedAt)&&validDate(snapshot.scheduledStartAt)&&
    validDate(snapshot.freeCancelUntil)&&
    snapshot.acceptedAt.getTime()<=snapshot.scheduledStartAt.getTime()&&
    snapshot.freeCancelUntil.getTime()<=snapshot.scheduledStartAt.getTime()&&
    Number.isSafeInteger(snapshot.policyRevision)&&snapshot.policyRevision>0&&
    typeof snapshot.timezone==='string'&&snapshot.timezone.length>0&&
    snapshot.timezone.length<=64;
}

/**
 * Time boundary is inclusive: a customer can cancel for free at the exact
 * free-cancel deadline; only later is late. The deadline must come from the
 * locked, persisted snapshot, never from the current editable offer policy.
 */
export function classifyRequestCancellation(
  input:CancellationContext,
):CancellationClassification{
  if(!input||!validDate(input.now)||
    (input.actor!=='customer'&&input.actor!=='provider')||
    !validId(input.customerPersonId)||!validId(input.sellerProfessionalId)||
    !validId(input.sellerOrganizationId)||
    (input.sellerProfessionalId===null)===(input.sellerOrganizationId===null)||
    typeof input.customerPenaltySuspended!=='boolean'||
    typeof input.scheduleReconciliationRequired!=='boolean'||
    !validSnapshot(input.snapshot))
    throw new CancellationPolicyRejected('invalid_context');
  if(input.state!=='PENDING'&&input.state!=='ACCEPTED')
    throw new CancellationPolicyRejected('conflict');
  if(input.scheduleReconciliationRequired)
    throw new CancellationPolicyRejected('schedule_reconciliation');

  if(input.state==='PENDING'){
    // No confirmed time -> no customer penalty or provider reliability event.
    return {
      nextState:input.actor==='customer'?'CANCELLED_BY_CUSTOMER':'CANCELLED_BY_PROVIDER',
      actor:input.actor==='customer'?'CUSTOMER':'SELLER',
      isLate:false,reliability:null,
      requiredAudiences:['INITIATOR','COUNTERPARTY'],
    };
  }

  if(input.actor==='customer'){
    // An accepted request without a valid immutable schedule snapshot cannot
    // be treated as late, nor can it be assigned a fabricated cutoff.
    const isLate=input.snapshot!==null&&
      input.now.getTime()>input.snapshot.freeCancelUntil.getTime();
    return {
      nextState:'CANCELLED_BY_CUSTOMER',actor:'CUSTOMER',isLate,
      reliability:isLate&&!input.customerPenaltySuspended&&input.customerPersonId
        ? {subject:'CUSTOMER',targetId:input.customerPersonId,
           reason:'LATE_CUSTOMER_CANCELLATION'} : null,
      requiredAudiences:['INITIATOR','COUNTERPARTY'],
    };
  }

  // Seller reliability belongs to the actual seller context, never the
  // assigned performer employee. No accepted schedule is invented.
  const professional=input.sellerProfessionalId;
  return {
    nextState:'CANCELLED_BY_PROVIDER',actor:'SELLER',isLate:false,
    reliability:professional
      ? {subject:'PROFESSIONAL',targetId:professional,reason:'PROVIDER_CANCELLATION'}
      : {subject:'ORGANIZATION',targetId:input.sellerOrganizationId!,
          reason:'PROVIDER_CANCELLATION'},
    requiredAudiences:['INITIATOR','COUNTERPARTY'],
  };
}
