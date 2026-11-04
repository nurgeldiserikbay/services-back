# GET /v1/me/seller-requests — native/server bearer-authenticated read API

This stacked change depends on Backend PR #15 (session-proof); it does NOT require PR #15 to be merged in order to review or run on its feature branch. Merge parent PR first, then retarget this PR to main.

A real GET controller is registered with `AppModule`. It requires an opaque `Authorization: Bearer <token>` created by a separately verified account login/session issuer using the PR #15 v1 hash algorithm. It rejects missing/malformed proofs and verifies active, unexpired, unrevoked session on the database. Database query allows ONLY:
- Personal requests whose professional profile is owned by the authenticated person.
- Organization requests where the authenticated user is an active OWNER/ADMIN member with unrestricted membership scope. Operator/auditor are excluded.
- No consumer contact, note, guest token, authentication secret, customer identity, location address, phone/email, pricing or schedule details apart from already agreed scheduled_start_at.

It supports a bounded page size 1–50, optional status, and canonical cursor ordered by (created_at,id), with no public caching. A read-only list cannot accept, decline or change requests. SQL checks authorization, not client-provided seller ID.

Security caveats: This endpoint is not a browser session endpoint and never reads cookies. Global CORS currently disallows Authorization, so web requires a dedicated same-origin SSR/BFF and Origin/CSRF/session rules. The account login/issuer is not yet wired; no real user can sign in through this PR alone. No claim of a production-ready request workflow. Implement separately with a vetted SMS/email login provider, session lifecycle, service offer booking flow and monitoring. Avoid leaking bearer tokens to logs, URL query strings, analytics or client storage.
