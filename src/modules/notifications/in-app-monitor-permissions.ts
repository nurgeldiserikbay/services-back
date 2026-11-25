import type {PoolClient} from 'pg';

type QueryClient=Pick<PoolClient,'query'>;

/**
 * Fail closed if the staging monitor's effective PostgreSQL role can mutate
 * the observed tables, read sensitive account/OTP data, or create persistent
 * schema objects. This is only an
 * access-control preflight, not a region or backup-residency attestation.
 */
export async function assertInAppMonitorReadOnlyRole(
 client:QueryClient,
):Promise<void>{
 try{
  const result=await client.query<{
   intents_select:boolean;events_select:boolean;
   intents_write:boolean;events_write:boolean;
   schema_create:boolean;database_create:boolean;
   users_read:boolean;sessions_read:boolean;contacts_read:boolean;
   mfa_factors_read:boolean;
  }>(`
   SELECT
    has_table_privilege(current_user,'public.notification_intents','SELECT')
     AS intents_select,
    has_table_privilege(current_user,'public.domain_outbox_events','SELECT')
     AS events_select,
    has_table_privilege(current_user,'public.notification_intents',
     'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS intents_write,
    has_table_privilege(current_user,'public.domain_outbox_events',
     'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS events_write,
    has_schema_privilege(current_user,'public','CREATE') AS schema_create,
    has_database_privilege(current_user,current_database(),'CREATE')
     AS database_create,
    has_table_privilege(current_user,'public.users','SELECT') AS users_read,
    has_table_privilege(current_user,'public.sessions','SELECT') AS sessions_read,
    has_table_privilege(current_user,'public.guest_contacts','SELECT') AS contacts_read,
    has_table_privilege(current_user,'public.platform_admin_totp_factors','SELECT')
     AS mfa_factors_read
  `,[]);
  if(result.rows.length!==1)throw Error('invalid_privilege_result');
  const row=result.rows[0];
  if(row.intents_select!==true||row.events_select!==true||
    row.intents_write!==false||row.events_write!==false||
    row.schema_create!==false||row.database_create!==false||
    row.users_read!==false||row.sessions_read!==false||
    row.contacts_read!==false||row.mfa_factors_read!==false)
    throw Error('in_app_monitor_role_not_read_only');
 }catch{
  // Database errors or malicious role names might contain credentials/PII.
  throw new Error('IN_APP monitor database role verification unavailable');
 }
}
