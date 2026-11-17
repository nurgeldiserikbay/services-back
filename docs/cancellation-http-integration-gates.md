# Cancellation HTTP input contract — default OFF

This is a design gate, not an enabled API. The new
`cancellation-command-contract.ts` parser only accepts:
- request UUID from a trusted route match;
- JSON object containing **only** `expectedVersion` as positive safe integer;
- a plain or null-prototype record with an **own data property** `expectedVersion` (never invoke getters or trust inherited/class properties);
- an optional **raw wire-level parser** `parseCancellationRawJsonBody`: UTF-8 text at most 128 bytes, JSON object with one literal `"expectedVersion"` key and one positive safe integer. It rejects duplicate JSON names (which `JSON.parse` would otherwise overwrite), escaped property aliases, extra keys and numeric ambiguities. A future adapter must bound bytes **before** decoding and invoke this parser before any authorization or state change;
- single `Idempotency-Key` header containing 16–128 ASCII alphanumeric,
  underscore or hyphen characters.

It **must not** accept the cancellation actor, seller context, reliability
weights, approval IDs, guest capability, penalty suspension or permission
flags from a browser. Inputs are untrusted even when syntactically valid.

## Unmounted HTTPS and origin preconditions

`assertCancellationTransportHeaders` accepts only a configured canonical HTTPS origin, an exact matching `Origin` header, `Sec-Fetch-Site: same-origin`, a trusted TLS protocol indicator (`https:`), and an allowlisted JSON Content-Type (`application/json` with optional UTF-8 charset). Header arrays, cross-site requests, unexpected media parameters and a mismatched/malformed configured origin are denied. The expected origin must come from trusted deployment configuration, not the incoming Host/X-Forwarded-Host headers; TLS information must come from the trusted server/proxy configuration, not untrusted X-Forwarded-Proto. This pure helper is **not mounted** and does not implement session-bound CSRF, capability authorization, idempotency or mutations. An actual adapter must also bound raw body bytes before decoding and call `parseCancellationRawJsonBody`.

## Unmounted session-bound CSRF comparison

`assertCancellationSessionCsrf` requires two canonical unpadded base64url 256-bit values and compares their decoded bytes in constant time. The **expected** value must come from an independently authenticated, server-verified session or an equivalent server-side request proof, not an attacker-controlled cookie/header; the submitted value is untrusted. Missing, forged and noncanonical token representations are rejected. This pure helper neither issues CSRF tokens nor authenticates a session, and must not be used as a standalone double-submit-cookie gate. The future adapter must call it only after verifying the principal and correctly binding the expected token to that principal.

## Composed unmounted preflight

`parseCancellationPreflight` combines the previously independent strict trusted HTTPS/Origin/Fetch Metadata/media-type checks, canonical session-bound CSRF comparison, strict single idempotency header and raw one-field JSON body validation. This is a **pure, unmounted** input boundary that returns a frozen command only after every check passes. It does **not** establish or verify an account/guest identity itself: `sessionExpectedCsrf`, the expected origin and trusted TLS state must be provided by an authenticated server-side context and trusted deployment configuration. An actual adapter still needs identity authorization, a principal-scoped PostgreSQL idempotency ledger, request lock, atomic mutation and HTTP/rollback E2E before route exposure.

## Guest-scoped idempotency identity (unmounted)

`deriveGuestCancellationIdempotency` deterministically derives an opaque HMAC-SHA256 ledger key from a **database-verified guest contact**, the POST method, the canonical cancellation request route and the caller's validated idempotency key. Separately, it hashes the canonical body (`expectedVersion`). Repeating the original key/body matches both digests; repeating the same key with a changed version keeps the ledger key but changes the body hash, allowing the eventual durable ledger to reject contradictory retries. Different verified guest contacts, request IDs or keys have distinct ledger identities. The HMAC secret must be a server-owned 32-byte key with controlled rotation, and **the verified guest identity must come from the active READ_CANCEL proof checked in PostgreSQL**, never browser JSON. Hashes are opaque transport-independent identities, not authorization or persistence.

This is **not yet a PostgreSQL ledger implementation**: before enabling an HTTP route the server must atomically reserve/serialize the scoped key, reject body-hash mismatch, replay only a committed matching response, lock and authorize the request, and commit the cancellation + outbox + two notifications + ledger result together. Test rollback, concurrent replays and secret-rotation behavior before release.

## Mandatory integration sequence (not yet implemented)

1. Verify account session or request-scoped guest capability. Determine the
   authorized principal and permitted transition from server-side evidence.
2. Reject non-HTTPS, cross-origin / invalid Fetch Metadata, missing CSRF,
   oversized request, duplicate JSON properties and unsupported content types
   in the actual HTTP adapter. Log no tokens/PII.
3. Start a single PostgreSQL transaction, serialize on the idempotency key
   scoped to principal, method, route, request hash. Reject reuse of the same
   key with a different payload; replay the stored response on a match.
4. Lock request row; check current version and seller/customer authorization.
   Resolve current membership **inside** the transaction.
5. Invoke the appropriate PENDING/ACCEPTED/guest atomic cancellation primitive.
   Commit cancellation history, busy-block release, dual notification intents,
   PII-free outbox and optional **PROPOSED** reliability event together.
6. Commit the response ledger entry in the same transaction. On failure,
   rollback all state. No auto-EFFECTIVE rating transition.
7. Add negative, rollback, concurrent cancellation, CSRF and guest capability
   E2E tests before exposing any route or enabling UI.

No public route, delivery worker or browser cancellation button is created here.
