# Seller decision authority — server-side gate

Internal authorization layer for previously merged seller accept/decline transaction. This reads the immutable seller on the request inside the same PostgreSQL transaction, checks user ACTIVE and professional ownership, or an ACTIVE organization's non-revoked OWNER/ADMIN membership. It deliberately fails closed for OPERATOR until organization-specific, per-service assignment scope semantics are finalized; AUDITOR is never allowed to decide. Membership rows are locked to avoid concurrent revocation races. No HTTP route is exposed.

**Security requirement:** `authenticatedUserId` MUST come from a separately verified, current server session, never any query param, cookie JSON, frontend role or request body. This is not a substitute for login/session security, request version preconditions, administrative audit, CSRF/Origin validation or per-source throttles. The backend's transaction service pairs the authority gate and immutable seller decision in one connection and rollback boundary.

Real PostgreSQL integration tests cover no membership, auditor denial, admin allowance, membership revocation, operator denial and non-member denial.

To enable the public route, complete identity/session validation, safe error mapping, user status checks, idempotency-key policy and review per-company scoped operator permissions. Do not claim working seller accept/decline UI until those gates pass.
