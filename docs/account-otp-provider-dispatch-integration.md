# Account OTP delivery adapter — dispatch and PostgreSQL integration tests

## Stage 1 — main delivery of the recipient guard

The earlier recipient normalization PR #75 was merged into an intermediate feature branch; its guard was still absent from main. PR #76 brings its exact validation, tests, and docs to main. This test PR is intentionally stacked on the same branch so it can run against the complete provider boundary.

## Stage 2 — accepted vendor receipt

Integration tests call the real `AccountOtpDispatchService` with `AccountOtpTemplateDeliveryAdapter`, signed trusted-edge network attestation and a PostgreSQL transaction fixture. The provider callback sees only rendered Kazakh email content and an opaque HMAC idempotency key; the public dispatch result never exposes OTP or destination. Only after accepted delivery does the challenge receive durable `delivery_confirmed_at`.

## Stage 3 — invalid receipt fails closed

An adapter vendor response with unexpected metadata is rejected. Dispatch consumes the committed challenge and leaves `delivery_confirmed_at` null. Its network issuance budget remains recorded so failing sends cannot be used to bypass throttles.

This is a **mock sender integration**, not a live SMS/email vendor. No real provider is connected, no public account login endpoint is enabled, and the approved KZ provider, egress timeout, anti-enumeration and end-to-end browser flow remain release gates. Merge PR #76 to main first, then retarget this PR to main.
