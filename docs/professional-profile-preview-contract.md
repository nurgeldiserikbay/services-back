# Owner-only professional profile preview
GET /v1/me/professional-profiles/{id}/preview. Default off: SERVICES_ENABLE_PROFILE_PREVIEW=enabled.
Live bearer and same-transaction owner scope. Response contains current draft and retained published snapshot, without contacts or offer details.
404 for foreign or unknown profile IDs; 401 for invalid sessions; no-store.
This endpoint does not authorize publication and must not be enabled before shared OpenAPI, HTTP/PostgreSQL, BFF and privacy reviews.
