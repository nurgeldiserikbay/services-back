# Privileged platform role change policy

The pure `canChangePlatformRole` helper composes the scoped, fresh-MFA
authorization from `admin-authorization.policy.ts` with conservative
role-change constraints. It is not an HTTP endpoint or a completed security
workflow.

- Only a verified `owner` with an exact `platform_roles:<target-uuid>`
  server-issued grant may change a staff role.
- Self-targeted changes are rejected even when UUID case differs.
- Owner creation, demotion or reassignment is deliberately not supported.
  A separately reviewed recovery/governance flow must protect the last owner.
- Only changes between `admin`, `operator` and `auditor` are eligible.
  Redundant no-op role changes are rejected.
- Expired sessions, stale MFA, missing target scope and unknown role values
  fail closed through the composed policy.

## Release blockers

Do **not** populate the principal from browser data. The future admin handler
must load the dedicated platform session, MFA time and grants from authoritative
database state and check revocation. It must load the **current** target role
within a transaction, lock/compare the record, apply a conditional update,
emit one sanitized durable audit event and handle retries/idempotency.
Read/write endpoint authorization, CSRF/origin, abuse limits, MFA enrollment,
and DB integration tests are not implemented here.

This helper is intentionally unmounted until those guarantees are available.
