/** Pure scheduling policy for future external notification workers.
 * This module does not claim or send messages; the worker must persist the
 * returned decision atomically with its delivery attempt.
 */
export type DeliveryRetryDecision=
 | Readonly<{state:'PENDING';nextAttemptAt:Date}>
 | Readonly<{state:'FAILED';nextAttemptAt:null}>;

export function planNotificationRetry(
 attemptsAfterFailure:number,
 now:Date,
 maxAttempts=5,
):DeliveryRetryDecision{
 if(!Number.isSafeInteger(attemptsAfterFailure)||attemptsAfterFailure<1)
  throw new RangeError('invalid_delivery_attempt_count');
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>20)
  throw new RangeError('invalid_delivery_max_attempts');
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
  throw new RangeError('invalid_delivery_retry_time');
 if(attemptsAfterFailure>=maxAttempts)
  return {state:'FAILED',nextAttemptAt:null};
 // 30s, 60s, 120s, ... capped at 30 minutes.
 const delayMs=Math.min(30_000*2**(attemptsAfterFailure-1),1_800_000);
 const timestamp=now.getTime()+delayMs;
 if(!Number.isFinite(timestamp)||timestamp>8_640_000_000_000_000)
  throw new RangeError('invalid_delivery_retry_time');
 return {state:'PENDING',nextAttemptAt:new Date(timestamp)};
}
