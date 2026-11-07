# Platform administration authorization policy foundation

This change adds a **pure, unmounted server-side permission policy** for platform owner, admin, operator and auditor. It is not exposed as an endpoint or accepted as proof of a live administrative area.

## Permissions

| Permission | owner | admin | operator | auditor |
| --- | --- | --- | --- | --- |
| moderation:read | yes | yes | yes | yes |
| moderation:decide | yes | yes | yes | no |
| taxonomy:read | yes | yes | yes | yes |
| taxonomy:publish | yes | yes | no | no |
| audit:read | yes | yes | no | yes |
| staff:read | yes | yes | no | no |
| staff:manage | yes | no | no | no |

Every decision rejects missing or malformed principals, unknown roles, extra fields, disabled principals, sessions without verified MFA, and expired sessions. Staff changes reject self-management, including case-variant UUIDs. These are preliminary conservative policy defaults requiring product/security review.

## Mandatory work before HTTP integration

- Authenticate a **dedicated platform administrator session** server-side, not a browser-supplied principal object or seller token. Enforce real MFA and revocation against DB state.
- Scope moderation and audit records by tenant/resource and use least privilege; this policy alone does not implement data scoping.
- Require fresh privileged verification for sensitive staff operations and implement safe role assignment constraints (including owner protection).
- Add DB-backed event auditing, atomic moderation writes, idempotency, rate limits and conflict handling.
- Test unauthorized/expired/revoked cases at the actual NestJS route and DB boundary before enabling any admin UI.

Run `npm run typecheck && npm run build && npm test`; test files existing in git are not evidence of a passing pipeline.
