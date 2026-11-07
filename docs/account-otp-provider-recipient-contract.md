# OTP vendor recipient canonicalization

The account OTP provider adapter is a private integration boundary. Besides its existing strict OTP template, HMAC deduplication key and exact receipt checks, the adapter now revalidates the destination using the existing Services contact normalization rule before any vendor callback.

Email must be a syntactically valid, already-normalized account address; a mixed-case domain or leading/trailing whitespace is rejected rather than silently transformed in the provider layer. SMS must be E.164 formatted (for example +77001234567). Control characters, injected headers and crossing email/SMS channels fail closed. Upstream issuance already normalizes the address: a mismatch at this boundary indicates a programming bug or tampered integration.

Tests prove invalid recipients cause zero provider calls and a valid canonical SMS address can pass. An explicit, external SMS/email vendor, approved Kazakhstan residency/consent, network timeouts, idempotency, and end-to-end account login remain separate launch gates.

Dependency chain: recover templates and adapter into main through PR #74, then apply this recipient contract PR.
