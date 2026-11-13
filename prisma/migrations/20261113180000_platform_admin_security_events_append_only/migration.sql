-- Security audit events are append-only, including for the application DB role.
-- This protects against accidental UPDATE/DELETE through application code.
CREATE FUNCTION "prevent_platform_admin_security_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform_admin_security_events is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "platform_admin_security_events_append_only"
BEFORE UPDATE OR DELETE ON "platform_admin_security_events"
FOR EACH ROW EXECUTE FUNCTION "prevent_platform_admin_security_event_mutation"();
