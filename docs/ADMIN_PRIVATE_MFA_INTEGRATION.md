# Private admin MFA integration — deployment gate

Status: **prepared, not deployed**. The `PrivateAdminMfaController` is intentionally absent from Nest controller registration. A feature flag alone must never expose it.

## Trusted dependency assembly

- Reuse the application `DatabasePool` via `adminMfaPoolAdapter` and `wirePrivateAdminMfa`. Never create a separate unbounded privileged pool.
- Provision independent, canonical 32-byte base64 credentials for account session HMAC, admin session HMAC and private BFF transport. Never reuse any of them as a TOTP encryption key.
- Supply `readTotpKey(version)` from an authenticated secret-manager client with least-privilege read access. Allowlist exact key versions in trusted deployment configuration; reject arbitrary secret paths and versions. Support old versions during a planned rotation window.
- Ensure secret-manager and database failures do not log request bodies, OTPs, session bearers or key material.
- Keep `SERVICES_ENABLE_ADMIN_MFA_PRIVATE_HTTP` disabled until ingress is restricted to the trusted admin BFF, service authentication and deployment acceptance are complete.

## Acceptance before enabling HTTP

1. Run `npm run typecheck`, `npm run build`, and the private MFA regression step in backend CI.
2. On a migrated, isolated PostgreSQL test database, verify primary account session freshness, factor activation, replay rejection, durable failed-attempt lockout, revoked grants, session issuance and session invalidation.
3. Exercise the real Nest HTTP boundary with wrong/missing BFF credentials, malformed payload, invalid TOTP, missing vault version, PostgreSQL errors and uncertain COMMIT. Verify no bearer on any failure and no sensitive details in response/logs.
4. Restrict network ingress and verify that external clients cannot reach the private endpoint. Add BFF integration with sealed HttpOnly admin cookies; never return the admin bearer to browser JavaScript.
5. Confirm green backend/admin main CI, staging security review, key rotation and rollback procedures before explicitly registering the controller.

No item in this document implies the private endpoint is currently enabled or production-ready.
