# Guest request access TTL alignment (ADR-0005)

A guest's CREATE_REQUEST proof is consumed when a request is committed. The
new READ_CANCEL capability is scoped to **that one request**, and expires
24 hours after issuance. This is the current approved ADR-0005 policy.

Before this change the backend issued READ_CANCEL for **30 days**, while the
canonical ADR specified **24 hours**. This change shortens the expiry and
asserts the persisted PostgreSQL capability and API response agree.

The capability is still an opaque secret, stored as a hash in PostgreSQL; it
must not be sent to client-side JavaScript, URLs, logs, analytics or public
caches. When a guest needs access after expiry, they must prove control of
the original contact through the separately designed recovery flow.

This fixes **newly created capabilities** only. Existing issued tokens are
not retroactively shortened; any migration/revocation of already-issued
tokens requires a separate reviewed operational change and customer-access
impact plan. The public guest request endpoint is not enabled by this PR.
