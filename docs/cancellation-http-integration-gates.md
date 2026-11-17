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
