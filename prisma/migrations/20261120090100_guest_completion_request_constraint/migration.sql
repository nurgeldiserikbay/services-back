-- Enforce request binding for every scoped, post-create guest authority.
-- CREATE_REQUEST may be unbound before a request exists and is bound after
-- successful creation; READ_CANCEL/MANAGE_SCHEDULE/COMPLETE_REQUEST must
-- always be associated with a concrete service request.
ALTER TABLE guest_capabilities
 DROP CONSTRAINT IF EXISTS guest_capability_scope_request;
ALTER TABLE guest_capabilities
 ADD CONSTRAINT guest_capability_scope_request CHECK (
  scope = 'CREATE_REQUEST'
  OR (scope IN ('READ_CANCEL','MANAGE_SCHEDULE','COMPLETE_REQUEST')
      AND request_id IS NOT NULL)
 );
