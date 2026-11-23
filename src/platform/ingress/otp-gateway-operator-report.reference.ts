import type {Pool,PoolClient} from 'pg';
import {
  readOtpGatewayReservationSnapshot,
  type OtpGatewayReservationSnapshot,
} from './otp-gateway-reservation-health.reference.js';

const DENIED='otp_gateway_operator_report_unavailable';

/**
 * Reference-only privileged operator access gate. The DB role must be
 * restricted to SELECT(status, claimed_at) on the DEDICATED gateway ledger.
 * No write, truncate, or access to identifiers/receipts is permitted.
 * This is not an HTTP endpoint or approval to deploy a monitoring agent.
 */
export async function readOtpGatewayOperatorReport(
  db:Pick<Pool,'query'>,
):Promise<OtpGatewayReservationSnapshot>{
  try{
    if(!db||typeof db.query!=='function')throw new Error(DENIED);
    const acl=await db.query<{
      status_allowed:boolean;claimed_allowed:boolean;
      identifier_allowed:boolean;fingerprint_allowed:boolean;
      reference_allowed:boolean;receipt_time_allowed:boolean;
      can_mutate:boolean;
    }>(`
      SELECT
        has_column_privilege(current_user,
          'otp_gateway_delivery_claims','status','SELECT') AS status_allowed,
        has_column_privilege(current_user,
          'otp_gateway_delivery_claims','claimed_at','SELECT') AS claimed_allowed,
        has_column_privilege(current_user,
          'otp_gateway_delivery_claims','idempotency_key','SELECT') AS identifier_allowed,
        has_column_privilege(current_user,
          'otp_gateway_delivery_claims','fingerprint','SELECT') AS fingerprint_allowed,
        has_column_privilege(current_user,
          'otp_gateway_delivery_claims','provider_ref','SELECT') AS reference_allowed,
        has_column_privilege(current_user,
          'otp_gateway_delivery_claims','accepted_at','SELECT') AS receipt_time_allowed,
        (
          has_any_column_privilege(current_user,
            'otp_gateway_delivery_claims','INSERT,UPDATE')
          OR has_table_privilege(current_user,
            'otp_gateway_delivery_claims','DELETE,TRUNCATE')
        ) AS can_mutate
    `);
    const role=acl.rows[0];
    if(acl.rows.length!==1||!role||
      role.status_allowed!==true||role.claimed_allowed!==true||
      role.identifier_allowed!==false||role.fingerprint_allowed!==false||
      role.reference_allowed!==false||role.receipt_time_allowed!==false||
      role.can_mutate!==false)throw new Error(DENIED);
    return await readOtpGatewayReservationSnapshot(db);
  }catch{
    // Never leak connection strings, database errors, role names or secrets.
    throw new Error(DENIED);
  }
}

/**
 * Keep role preflight and report on the SAME database connection, inside a
 * server-enforced READ ONLY transaction. A generic Pool.query() per step can
 * otherwise select different sessions or search_path configurations.
 * Always release the connection and avoid leaking PostgreSQL diagnostics.
 */
export async function runOtpGatewayOperatorReportReadOnly(
  pool:Pick<Pool,'connect'>,
):Promise<OtpGatewayReservationSnapshot>{
  let client:PoolClient|undefined;
  let transactionStarted=false;
  try{
    if(!pool||typeof pool.connect!=='function')throw new Error(DENIED);
    client=await pool.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    transactionStarted=true;
    const report=await readOtpGatewayOperatorReport(client);
    await client.query('ROLLBACK');
    transactionStarted=false;
    return report;
  }catch{
    throw new Error(DENIED);
  }finally{
    if(client){
      if(transactionStarted){
        try{await client.query('ROLLBACK');}catch{
          // Connection is destroyed below, not returned for reuse.
        }
      }
      // Explicitly dispose the one-shot session to prevent role bleed.
      client.release(true);
    }
  }
}
