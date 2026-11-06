# Account OTP global send budget — internal gate

This change extends private account OTP issuance; it does not expose an authentication HTTP endpoint.

## Stage 1: PostgreSQL global ceiling

`checkAccountOtpGlobalBudget` runs on the SAME transaction connection as the challenge insert. It takes a global transaction advisory lock BEFORE the per-contact advisory lock. All application replicas therefore serialize the count-and-insert critical section and retain the lock until COMMIT/ROLLBACK. Both SIGN_IN and SIGN_UP and both EMAIL and SMS count toward a single ceiling. Consumed/expired challenges still count while inside the rolling creation window.

Defaults: 30 challenges per minute, 300 per hour, 3000 per rolling 24h. A denied attempt raises `AccountOtpIssuanceUnavailable` and does not insert a challenge. No contact, OTP, token, IP, or detailed quota counts are included in the exception.

## Stage 2: integration into private account challenge issuance

Global budget check and lock are acquired **before** per-contact quota lock and challenge creation. This lock order is mandatory for every issuer using this table; bypassing the helper in another process defeats the budget. All callers MUST execute issuance within `DatabasePool.transaction`; do not call with a shared autocommit pool query interface.

## Stage 3: database security tests

Real PostgreSQL tests cover minute/hour/day ceilings, both account purposes and channels, and rejected issuance not creating a challenge. Limit testing uses rolled-back transactions so fixtures never remain in a deployed dataset.

## Remaining release gates

This global ceiling is NOT a per-network/IP/device budget. A future public account OTP endpoint also requires trusted-edge network identity, independent device budgets, verified delivery provider, anti-enumeration, successful sign-in versus sign-up consent mapping, abuse telemetry without private data, and account session issuance/revocation. Guest OTP quotas are purpose-isolated and should not be silently reused for account challenges. A public API must not reveal quota counters or whether a contact belongs to an account. No externally reachable account OTP endpoint is added here.
