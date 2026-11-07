# Admin database and server authorization integration — staged foundation

1. **Storage**: Prisma models and an additive SQL migration define dedicated
`platform_admin_staff`, `platform_admin_sessions` and `platform_admin_grants`.
Existing member/seller roles are NOT platform staff. No seed or privileged
identity is automatically created.
2. **Resolver**: each request's opaque administrator bearer is HMAC-hashed
with a separate secret, then looked up using current DB session validity,
disabled staff, active user and current resource grants. All grants are
bounded to 100; session proof is not cached.
3. **NestJS service**: `PlatformAdminAccessService.requireOperation` checks
Bearer syntax, loads live DB state within a transaction, and applies
`canPerformAdminOperation` including recent MFA and exact target scope.
It is currently **unmounted**, because audited admin MFA enrollment and
session issuance do not exist.

## Important release gates

- **Migration review**: validate migration order and Prisma schema in staging,
  run `prisma migrate deploy`, verify SQL DDL and rollback/backup. No
  production migration is claimed.
- **MFA**: independently enroll and verify privileged identities and
  require fresh MFA for all privileged operations; this PR never creates
  verified MFA timestamps or admin sessions.
- **Authorization at write-time**: for mutations, lock affected resources,
  re-check current grants/roles/MFA and target state in the same transaction,
  write sanitized audit event and apply idempotency.
- **Read API**: add dedicated admin-only controller after route/session
  hardening, and an actual moderation-case read model. ModerationCase is
  not currently a Prisma model.
- **Browser**: secure same-origin BFF only, HttpOnly/Secure cookie, CSRF,
  origin validation, rate limits, no raw backend bearer or key in browser.
- **Security**: audit service-secret management, PII, KZ residency,
  revocation, incident response and observability before enabling endpoints.

Run `npm run db:validate`, `npm run typecheck`,
`npm run build`, `npm test` and staging migration/DB integration tests.
Tests shipped in this PR do not prove these checks passed.
