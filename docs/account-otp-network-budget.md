# Account OTP trusted-network budget (private integration)

Three stages extending the **stacked** global OTP budget branch PR #53:

1. **Dedicated network ledger:** `account_otp_network_issuances` stores only a keyed, non-reversible 64-hex network digest and a timestamp. A separate account ledger prevents account sign-in/signup traffic from consuming guest CREATE_REQUEST budgets. The approved, separately deployed ingress strips untrusted inbound proof headers, derives a canonical network bucket from its authenticated connection/proxy chain, and signs a short-lived `v1` proof. `verifyAccountOtpNetworkProof` validates that proof; never derive network identity from arbitrary `X-Forwarded-For` or untrusted body/header content.
2. **Atomic issuance:** The internal account issuer, if given a **preverified** network digest, checks the 5/min, 20/hour, 50/24h budget, then contact quota, inserts the challenge and appends network ledger **in the same PostgreSQL transaction**. Required lock order is global -> network -> contact. Missing network digest remains allowed only for the pre-existing internal tests/callers; all future public HTTP routes MUST reject it before issuance. Fail-closed delivery is still disabled by default.
3. **PostgreSQL tests:** verify proof freshness, forged proof rejection, separate network identities, network cap and challenge + ledger co-commit. Existing tests for account OTP issuance continue to run unchanged.

## Deployment and retention gates

This is **not an exposed account login or OTP sending service**. Do not enable externally until account OTP provider, edge attestation, network/device budgets, global quotas, uniform anti-enumeration responses, rate-limited login/registration, explicit signup consent, registered identity lookup and account session issuance are implemented and verified. Network /24 and /64 bucketing requires operator review because NAT and mobile carrier gateways may share identity; network caps should not indiscriminately block legitimate users. No IP, raw contact, OTP, or bearer must appear in DB logs or HTTP responses. Schedule retention pruning of this ledger older than a reviewed window (rolling 24 hours plus operational margin) before production. Avoid logging raw provider messages. Always use `DatabasePool.transaction`; advisory locks taken in autocommit mode do not protect check/insert races.

## PR order

PR #53 (global budget) must merge into main before rebasing this stacked PR. This PR targets `feat/account-otp-global-budget-20261106` until then, not main. Do not merge it into a temporary feature branch and mistake that for main release.
