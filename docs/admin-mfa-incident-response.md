# Platform admin MFA incident response (server-only)

## Status
The TOTP factor revocation primitive is **not** an HTTP endpoint. Do not expose it through a route or allow the browser to supply the acting staff identity. Full primary-factor login and Admin BFF integration remain pending.

## Authorization contract
`revokeAdminTotpFactor(pool, actorBearer, targetStaffId, sessionPepper, now)` hashes the canonical bearer using the dedicated admin session HMAC domain. The transaction requires a non-revoked, unexpired MFA-verified session; active staff and user; role `owner`; explicit grant `admin.security.revoke`; and an activated, non-disabled actor TOTP factor. All failures deny access. Do not log bearer, OTP, factor ciphertext or session pepper.

## Atomic effects
The transaction acquires the target staff advisory lock, checks the actor, disables the target TOTP factor, revokes target admin sessions and inserts `totp_factor_revoked` into `platform_admin_security_events`. Audit insertion failure rolls back all changes. The token is never returned from this operation.

## Recovery and operations
- Verify the incident and target identity using an independently authenticated out-of-band channel.
- Obtain dual approval under the organization's incident policy; this approval is **not yet enforced by code**.
- Grant `admin.security.revoke` only via a reviewed privileged provisioning process; the grant issuance workflow is **not yet implemented**.
- Perform revocation through a future authenticated server-side operation, never by SQL snippets copied from an untrusted request.
- Confirm that the audit event exists and the target's active admin sessions are revoked.
- The current provisioning implementation uses `ON CONFLICT DO NOTHING`; **re-enrollment after revocation is not yet supported**. Do not manually clear disabled factors without a separately audited, authorized recovery design.
- Treat missing migrations, failed audit writes and unexpected database errors as fail-closed. Do not claim success until COMMIT completes.

## Required before production
1. Trusted primary authentication and secure Admin BFF session issuance.
2. Reviewed privileged grant management and dual-approval recovery workflow.
3. Recovery/re-enrollment implementation with atomic audit and replay reset.
4. Real PostgreSQL concurrency tests for revocation vs login/activation and end-to-end CI.
5. Threat modeling, access review, incident monitoring and KZ data-residency validation.
