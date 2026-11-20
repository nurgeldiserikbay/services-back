-- Existing request-bound guest capabilities are purpose-scoped and enforced
-- by a database CHECK. The new completion purpose must also be request-bound.
-- CREATE_REQUEST remains optionally unbound before it creates its request.
ALTER TYPE "GuestCapabilityScope" ADD VALUE IF NOT EXISTS 'COMPLETE_REQUEST';

ALTER TABLE guest_capabilities
 DROP CONSTRAINT IF EXISTS guest_capability_scope_request;
ALTER TABLE guest_capabilities
 ADD CONSTRAINT guest_capability_scope_request CHECK (
  scope = 'CREATE_REQUEST'
  OR (scope IN ('READ_CANCEL','MANAGE_SCHEDULE','COMPLETE_REQUEST')
      AND request_id IS NOT NULL)
 );
