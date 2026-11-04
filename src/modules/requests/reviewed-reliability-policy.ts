/**
 * A review-approved policy is an explicit dependency of any proposed rating
 * change. There is deliberately no default, implicit numeric score or auto-
 * effectiveness. A trusted server configuration loader supplies this object.
 */
export type ReviewedReliabilityPolicy=Readonly<{
  formulaVersion:string;
  lateCustomerWeight:string;
  approvalId:string;
}>;
export class ReliabilityPolicyUnavailable extends Error{
  constructor(){super('reliability_policy_unavailable');}
}
export function validateReviewedReliabilityPolicy(
  value:unknown,
):ReviewedReliabilityPolicy{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new ReliabilityPolicyUnavailable();
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==3||
    typeof v.formulaVersion!=='string'||
    !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(v.formulaVersion)||
    typeof v.approvalId!=='string'||
    !/^[A-Z0-9][A-Z0-9_-]{5,63}$/.test(v.approvalId)||
    typeof v.lateCustomerWeight!=='string'||
    !/^(?:0\.[0-9]{1,2}|[1-9][0-9]?(?:\.[0-9]{1,2})?)$/.test(v.lateCustomerWeight)||
    Number(v.lateCustomerWeight)<=0)
    throw new ReliabilityPolicyUnavailable();
  return {
    formulaVersion:v.formulaVersion,
    lateCustomerWeight:v.lateCustomerWeight,
    approvalId:v.approvalId,
  };
}
