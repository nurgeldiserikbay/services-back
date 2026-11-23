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
 * Refuse temporary tables and views that could shadow the real ledger via
 * search_path; the query must resolve to an ordinary persistent table.
 * This is not an HTTP endpoint or approval to deploy a monitoring agent.
 */
export async function readOtpGatewayOperatorReport(
  db:Pick<Pool,'query'>,
  expectedSchema?:string,
):Promise<OtpGatewayReservationSnapshot>{
  try{
    if(!db||typeof db.query!=='function')throw new Error(DENIED);
    const acl=await db.query<{
      status_allowed:boolean;claimed_allowed:boolean;
      identifier_allowed:boolean;fingerprint_allowed:boolean;
      reference_allowed:boolean;receipt_time_allowed:boolean;
      can_mutate:boolean;relation_is_persistent_table:boolean;
      relation_in_expected_schema:boolean;
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
        ) AS can_mutate,
        EXISTS (
          SELECT 1 FROM pg_class AS ledger
          JOIN pg_namespace AS ns ON ns.oid=ledger.relnamespace
          WHERE ledger.oid='otp_gateway_delivery_claims'::regclass
            AND ledger.relkind='r'
            AND ledger.relpersistence='p'
            AND ns.nspname NOT LIKE 'pg_temp_%'
            AND ns.nspname NOT LIKE 'pg_toast%'
        ) AS relation_is_persistent_table,
        EXISTS (
          SELECT 1 FROM pg_class AS ledger
          JOIN pg_namespace AS ns ON ns.oid=ledger.relnamespace
          WHERE ledger.oid='otp_gateway_delivery_claims'::regclass
            AND ($1::text IS NULL OR ns.nspname=$1::text)
        ) AS relation_in_expected_schema
    `,[expectedSchema??null]);
    const role=acl.rows[0];
    if(acl.rows.length!==1||!role||
      role.status_allowed!==true||role.claimed_allowed!==true||
      role.identifier_allowed!==false||role.fingerprint_allowed!==false||
      role.reference_allowed!==false||role.receipt_time_allowed!==false||
      role.can_mutate!==false||
      role.relation_is_persistent_table!==true||
      role.relation_in_expected_schema!==true)throw new Error(DENIED);
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
  expectedSchema?:string,
  verifyServerTls=false,
  expectedDatabase?:string,
  expectedRole?:string,
):Promise<OtpGatewayReservationSnapshot>{
  let client:PoolClient|undefined;
  let transactionStarted=false;
  try{
    if(!pool||typeof pool.connect!=='function')throw new Error(DENIED);
    // This parameter comes from operator-approved deployment config, never
    // a user request or the database session's pre-existing search_path.
    if(expectedSchema!==undefined&&(
      !/^[a-z_][a-z0-9_]{0,62}$/.test(expectedSchema)||
      expectedSchema.startsWith('pg_')||
      expectedSchema==='information_schema'
    ))throw new Error(DENIED);
    client=await pool.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    transactionStarted=true;
    if(expectedSchema!==undefined){
      // Explicitly put pg_temp AFTER the trusted schema so even an existing
      // namesake temporary table cannot take precedence. Never concatenate
      // an unchecked identifier into SQL.
      await client.query(
        "SELECT set_config('search_path', format('%I, pg_temp', $1::text), true)",
        [expectedSchema],
      );
    }
    if(verifyServerTls){
      // pg_stat_ssl is scoped to this exact backend PID and transaction.
      // The client TLS settings already enforce CA and hostname checks.
      const tls=await client.query<{ssl:boolean;version:string|null}>(`
        SELECT ssl,version FROM pg_stat_ssl WHERE pid=pg_backend_pid()
      `);
      if(tls.rows.length!==1||tls.rows[0]?.ssl!==true||
        !['TLSv1.2','TLSv1.3'].includes(tls.rows[0]?.version??''))
        throw new Error(DENIED);
    }
    if(expectedDatabase!==undefined){
      // Check the actual selected database in the SAME pinned transaction
      // before any observer ACL/ledger query, not only the URL text.
      if(!/^[a-z_][a-z0-9_]{0,62}$/.test(expectedDatabase)||
        expectedDatabase.startsWith('pg_'))
        throw new Error(DENIED);
      const dbIdentity=await client.query<{name:string}>(
        'SELECT pg_catalog.current_database() AS name',
      );
      if(dbIdentity.rows.length!==1||
        dbIdentity.rows[0]?.name!==expectedDatabase)
        throw new Error(DENIED);
    }
    if(expectedRole!==undefined){
      // Validate both role identities from this actual PostgreSQL session:
      // session_user identifies authenticated login; current_user can differ
      // after SET ROLE. No role switching is permitted for this observer.
      if(!/^[a-z_][a-z0-9_]{0,62}$/.test(expectedRole)||
        expectedRole.startsWith('pg_')||expectedRole==='postgres')
        throw new Error(DENIED);
      const roleIdentity=await client.query<{
        session_role:string;effective_role:string;
      }>('SELECT session_user::text AS session_role, current_user::text AS effective_role');
      if(roleIdentity.rows.length!==1||
        roleIdentity.rows[0]?.session_role!==expectedRole||
        roleIdentity.rows[0]?.effective_role!==expectedRole)
        throw new Error(DENIED);
    }
    const report=await readOtpGatewayOperatorReport(client,expectedSchema);
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
      try{
        client.release(true);
      }catch{
        // Connection disposal failures must never expose PG diagnostics.
        throw new Error(DENIED);
      }
    }
  }
}
