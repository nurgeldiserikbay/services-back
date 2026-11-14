import type {PoolClient} from 'pg';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS=new Set([
 'totp_factor_activated',
 'totp_activation_failed',
 'admin_mfa_login_succeeded',
 'admin_mfa_login_failed',
]);

/** Append a minimal audit event in the SAME transaction as the MFA decision. */
export async function recordAdminMfaSecurityEvent(
 db:Pick<PoolClient,'query'>,
 staffId:string,
 action:string,
):Promise<void>{
 if(!db||typeof db.query!=='function'||
    typeof staffId!=='string'||!UUID.test(staffId)||
    typeof action!=='string'||!ACTIONS.has(action))
  throw new Error('invalid_admin_mfa_audit_event');
 const result=await db.query<{id:string}>(`
  INSERT INTO platform_admin_security_events
    (actor_staff_id,target_staff_id,action)
  VALUES ($1::uuid,$1::uuid,$2)
  RETURNING id::text
 `,[staffId,action]);
 if(!result||!Array.isArray(result.rows)||result.rows.length!==1||
    typeof result.rows[0]?.id!=='string'||!UUID.test(result.rows[0].id))
  throw new Error('admin_mfa_audit_unavailable');
}
