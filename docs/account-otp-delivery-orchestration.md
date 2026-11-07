# Account OTP delivery orchestration — internal only

This change introduces three stages of the registered-account OTP sending pipeline, without enabling a public account login API.

## 1. Committed challenge issuance

`AccountOtpDispatchService.dispatch` requires a short-lived signed trusted-edge network proof, the purpose (SIGN_IN/SIGN_UP), channel (EMAIL/SMS), contact, and kk/ru locale. It verifies the network assertion using the backend's 32-byte `ACCOUNT_NETWORK_ATTESTATION_KEY`, and loads separate OTP/contact HMAC and contact encryption secrets.

It calls `issueAccountOtpChallenge` inside `DatabasePool.transaction`. The existing global -> network -> contact quotas and the encrypted challenge + network budget ledger must commit together **before** any provider is invoked. A rejected send is still charged against quotas. An absent/forged/expired network proof fails closed without database access.

## 2. Approved provider boundary and failure reconciliation

Only the in-process `AccountOtpDeliveryPort` receives normalized destination and raw six-digit OTP. The default `DisabledAccountOtpDelivery` throws. A successful, sanitized provider receipt results in a narrow `{challengeId,expiresInSeconds}` internal result: never the code, destination, account identity, token, provider reference, or quota counters.

Rejected, malformed, thrown, or uncertain provider outcomes mark the **committed** account challenge `consumed_at=now()` to prevent an unexpectedly late delivered code from being used. Budget history remains, limiting retry abuse. DB/provider exception details are not returned or logged. If the database becomes unavailable during this compensation, the short expiry and attempt budget remain defenses, but this must be operationally monitored before public rollout.

The default provider is intentionally unconfigured. This work does **not** select an SMS/email vendor, send a real message, create a login endpoint, or create a browser session.

## 3. PostgreSQL tests and launch gates

Tests cover signed/forged network proofs, successful provider delivery with encrypted challenge and recorded network issuance, delivery refusal with consumed challenge and retained send budget, and the default-disabled provider.

Before public account OTP issuance: select and vet a KZ-residency-compliant delivery provider, verify message templates and provider credentials, ensure trusted ingress strips user-provided network assertions, add a separate trusted **device** budget and anti-enumeration responses, review signup consent/registered contact enrollment, and audit provider delivery latency and failed compensation without recording PII. Also review durable dispatch/outbox architecture where delivery after commit can be recovered safely from process crashes; this orchestrator currently has a process-crash gap between commit and provider call. Complete web HttpOnly/CSRF session issuance, mobile refresh rotation and end-to-end tests prior to enabling registered login. **Never substitute guest OTP as account identity.**
