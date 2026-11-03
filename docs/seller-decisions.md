# Seller decisions — internal transaction core

Implements the PENDING → ACCEPTED / DECLINED transitions for a service request in one caller-owned PostgreSQL transaction, with a row lock and expected version. Replays the identical immediately prior outcome but rejects a conflicting decision. Derives the immutable seller identity from the ServiceRequest; trusts only a **server-authenticated and per-resource authorized** seller identity passed by the caller.

Acceptance creates no confirmed time, calendar block or cancellation penalty. The parties must confirm time in a separate bilateral scheduling operation. Neither acceptance nor decline negotiates a price.

Each committed transition also creates a domain event and one logical customer notification intent. Authenticated clients get IN_APP; verified guest contacts get an EMAIL/SMS intent. **No external message is sent by this module**; actual guest provider delivery is not implemented.

DO NOT register public accept/decline routes until account auth/session, owner or company membership ACL, audit, rate limiting and request-status read APIs are ready. Must not treat a passed seller ID as authentication. Caller owns BEGIN/COMMIT/ROLLBACK using `DatabasePool.transaction`. Real PostgreSQL tests validate state transitions, replay, no duplicate intent, seller boundary and no invented booking time.
