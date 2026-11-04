# Cancellation reliability evidence v1

Implements the deterministic, side-effect-free reliability decision for
ADR-0004 (accepted product direction) and CAN-T13, without public scoring,
account suspension or financial penalties.

## Versioned proposal weights

- PENDING cancellation: no reliability penalty for either side.
- Accepted registered-customer cancellation after the **confirmed, immutable,
  effective** cutoff but before the service starts: proposed weight **1.00**.
- Accepted provider cancellation: seller professional or seller organization
  (never assigned employee) gets **0.50** at least 24 hours before the
  confirmed service start, otherwise **1.00**. If the request is accepted
  without a confirmed time, the product default proposes **0.50**.
- Guest customer: no persistent customer score; suspension due to a seller
  reschedule or missing agreement blocks an automatic customer proposal.
- Ineligibility results in **no event**, not an invented final score.

The deadline calculation uses:
`B = start - snapshot policy minutes` and
`ready = max(requestAcceptedAt,agreementConfirmedAt)`.
If `ready >= start`, no automatic late penalty is eligible.
If `ready > B`, deadline is `min(start,ready + 15 minutes)`;
otherwise it is `B`. Exactly at the deadline is still on time.

The caller must compare the recalculated deadline with the stored
effective snapshot and must provide immutable confirmed agreement
evidence. Never infer that seller acceptance alone confirmed the date,
and never use client-provided timestamps or a live mutable policy.

## Still to integrate safely

This is a pure evaluator. It **does not** perform PostgreSQL writes or
materialize a public score. A later, audited service must write PROPOSED
reliability_events in the **same** transaction as request cancellation,
the event and two notifications, with a stable dedupe key, one record
per breach, and moderation/dispute/suppression support.

The score projection remains private until sufficient eligible history,
human appeal process and legal/fairness checks are complete. The full
ADR score formula uses 180-day events and distinct customer/provider
histories; it does not alter service-review star ratings. No public
HTTP route is enabled in this change.
