/**
 * ADR-0004 reliability policy v1. A reliability event is NOT a service review,
 * a payment fine, or a public numeric score. A future transaction may persist
 * the proposal atomically; moderation/suppression is handled separately.
 */
export const RELIABILITY_POLICY_VERSION='cancel-reliability-v1' as const;
export type ReliabilityActor='customer'|'provider';
export type ReliabilityProposal=Readonly<{
  subject:'CUSTOMER'|'PROFESSIONAL'|'ORGANIZATION';
  targetId:string;
  reason:'LATE_CUSTOMER_CANCELLATION'|'PROVIDER_CANCELLATION';
  weight:'1.00'|'0.50';
  formulaVersion:typeof RELIABILITY_POLICY_VERSION;
}>;
export type ReliabilityDecision=Readonly<{
  proposal:ReliabilityProposal|null;
  late:boolean;
  /** Null means not eligible, never that an event was already persisted. */
  reason:'pending'|'not_eligible'|'suspended'|'missing_agreement'|
    'before_deadline'|'eligible_customer'|'eligible_provider';
  deadline:Date|null;
}>;
export type ReliabilityContext=Readonly<{
  state:'PENDING'|'ACCEPTED';
  actor:ReliabilityActor;
  now:Date;
  customerPersonId:string|null;
  sellerProfessionalId:string|null;
  sellerOrganizationId:string|null;
  customerPenaltySuspended:boolean;
  /**
   * For customer penalties, confirmation is mandatory; for provider
   * cancellation the accepted request alone is a business commitment.
   */
  schedule:Readonly<{
    startAt:Date;
    acceptedAt:Date;
    confirmedAt:Date|null;
    freeCancelBeforeMin:number;
    effectiveDeadline:Date|null;
  }>|null;
}>;

export class ReliabilityPolicyUnavailable extends Error{
  constructor(){super('Invalid reliability policy evidence');}
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MINUTE=60000;
function isDate(d:unknown):d is Date{
  return d instanceof Date&&Number.isFinite(d.getTime());
}
function assertEvidence(input:ReliabilityContext){
  if(!input||!isDate(input.now)||
     (input.actor!=='customer'&&input.actor!=='provider')||
     (input.state!=='PENDING'&&input.state!=='ACCEPTED')||
     typeof input.customerPenaltySuspended!=='boolean'||
     (input.customerPersonId!==null&&!UUID.test(input.customerPersonId))||
     (input.sellerProfessionalId!==null&&!UUID.test(input.sellerProfessionalId))||
     (input.sellerOrganizationId!==null&&!UUID.test(input.sellerOrganizationId))||
     (input.sellerProfessionalId===null)===(input.sellerOrganizationId===null))
    throw new ReliabilityPolicyUnavailable();
  if(input.schedule){
    const s=input.schedule;
    if(!isDate(s.startAt)||!isDate(s.acceptedAt)||
       (s.confirmedAt!==null&&!isDate(s.confirmedAt))||
       (s.effectiveDeadline!==null&&!isDate(s.effectiveDeadline))||
       !Number.isSafeInteger(s.freeCancelBeforeMin)||
       s.freeCancelBeforeMin<0||s.freeCancelBeforeMin>10080)
      throw new ReliabilityPolicyUnavailable();
  }
}

/**
 * Effective cutoff for a confirmed agreement (CAN-T13). A seller's request
 * acceptance is not by itself a confirmed appointment.
 *
 * "confirmedAt" is immutable evidence from a confirmed ScheduleProposal,
 * never a browser-submitted clock. The first 15 minutes after BOTH consent
 * and acceptance are protected, bounded by service start.
 */
export function computeEffectiveCancellationDeadline(input:{
  startAt:Date;acceptedAt:Date;confirmedAt:Date;
  freeCancelBeforeMin:number;
}):Date|null{
  const {startAt,acceptedAt,confirmedAt,freeCancelBeforeMin}=input;
  if(!isDate(startAt)||!isDate(acceptedAt)||!isDate(confirmedAt)||
     !Number.isSafeInteger(freeCancelBeforeMin)||
     freeCancelBeforeMin<0||freeCancelBeforeMin>10080)
    throw new ReliabilityPolicyUnavailable();
  const start=startAt.getTime();
  const consent=Math.max(acceptedAt.getTime(),confirmedAt.getTime());
  if(consent>=start)return null;
  const base=start-freeCancelBeforeMin*MINUTE;
  return new Date(consent>base
    ? Math.min(start,consent+15*MINUTE)
    : base);
}

/**
 * Classifies a proposed reliability event. No SQL writes, external calls,
 * score changes or penalties. Never invent a confirmed schedule.
 */
export function evaluateCancellationReliability(
  input:ReliabilityContext,
):ReliabilityDecision{
  assertEvidence(input);
  const none=(reason:ReliabilityDecision['reason'],
    deadline:Date|null=null):ReliabilityDecision=>({
      proposal:null,late:false,reason,deadline,
    });
  if(input.state==='PENDING')return none('pending');
  if(input.customerPenaltySuspended)return none('suspended');
  const s=input.schedule;
  const now=input.now.getTime();

  if(input.actor==='customer'){
    if(input.customerPersonId===null)return none('not_eligible');
    if(!s||s.confirmedAt===null||s.effectiveDeadline===null)
      return none('missing_agreement');
    const derived=computeEffectiveCancellationDeadline({
      startAt:s.startAt,acceptedAt:s.acceptedAt,
      confirmedAt:s.confirmedAt,freeCancelBeforeMin:s.freeCancelBeforeMin,
    });
    // Fail closed: no negative event if the persisted snapshot differs
    // from the independently computed deadline or agreed time is invalid.
    if(!derived||derived.getTime()!==s.effectiveDeadline.getTime()||
       now>=s.startAt.getTime())
      return none('missing_agreement');
    if(now<=derived.getTime())return none('before_deadline',derived);
    return {
      proposal:{subject:'CUSTOMER',targetId:input.customerPersonId,
        reason:'LATE_CUSTOMER_CANCELLATION',weight:'1.00',
        formulaVersion:RELIABILITY_POLICY_VERSION},
      late:true,reason:'eligible_customer',deadline:derived,
    };
  }

  // Provider cancellation of an accepted request counts against the actual
  // seller, never an assigned company employee. A confirmed start gives
  // a 24-hour cutoff; an accepted request with no agreed time has weight 0.5.
  const start=s?.confirmedAt!==null?s?.startAt:null;
  const weight=start&&now<=start.getTime()-24*60*MINUTE?'0.50':
    start?'1.00':'0.50';
  const subject=input.sellerProfessionalId?'PROFESSIONAL':'ORGANIZATION';
  return {
    proposal:{
      subject,
      targetId:input.sellerProfessionalId??input.sellerOrganizationId!,
      reason:'PROVIDER_CANCELLATION',weight,
      formulaVersion:RELIABILITY_POLICY_VERSION,
    },
    late:false,reason:'eligible_provider',deadline:null,
  };
}
