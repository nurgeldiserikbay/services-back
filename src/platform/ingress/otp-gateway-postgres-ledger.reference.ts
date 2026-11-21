import type {Pool} from 'pg';

/**
 * Gateway-only reference ledger. NOT part of Nest runtime or guest HTTP.
 *
 * A reservation is durably committed BEFORE contacting an SMS/email vendor.
 * Pending claims are deliberately NEVER reclaimed automatically: after an
 * ambiguous network outcome, a second send could duplicate a real delivery.
 * A separately approved reconciliation process must inspect the provider
 * using its own idempotency key before resolving an ambiguous outcome.
 *
 * Use a DEDICATED gateway PostgreSQL database with the schema in
 * docs/reference/otp-gateway-idempotency-ledger.sql.
 */
export type OtpGatewayClaim=
  |Readonly<{decision:'send'}>
  |Readonly<{decision:'in_flight'}>
  |Readonly<{decision:'accepted';providerRef:string}>
  |Readonly<{decision:'conflict'}>;

type Row={fingerprint:string;status:string;provider_ref:string|null};

const HEX=/^[a-f0-9]{64}$/;
const REF=/^[a-zA-Z0-9_-]{8,120}$/;
const FAILURE='otp_gateway_ledger_unavailable';

function assertClaimInput(key:unknown,fingerprint:unknown):asserts key is string{
  if(typeof key!=='string'||!HEX.test(key)||
     typeof fingerprint!=='string'||!HEX.test(fingerprint))
    throw new Error(FAILURE);
}

export class OtpGatewayPostgresLedger {
  constructor(private readonly db:Pick<Pool,'query'>){}

  /**
   * INSERT uniqueness is the cross-instance synchronization point.
   * A second statement (not a single-statement CTE) is necessary because
   * ON CONFLICT may observe an uncommitted competing insert that the first
   * statement's READ COMMITTED snapshot could not SELECT.
   */
  async claim(key:unknown,fingerprint:unknown):Promise<OtpGatewayClaim>{
    assertClaimInput(key,fingerprint);
    try{
      const inserted=await this.db.query<{idempotency_key:string}>(`
        INSERT INTO otp_gateway_delivery_claims
          (idempotency_key,fingerprint,status)
        VALUES($1,$2,'RESERVED')
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING idempotency_key
      `,[key,fingerprint]);
      if(inserted.rows.length===1)return {decision:'send'};
      if(inserted.rows.length!==0)throw new Error(FAILURE);
      const existing=await this.db.query<Row>(`
        SELECT fingerprint,status,provider_ref
        FROM otp_gateway_delivery_claims
        WHERE idempotency_key=$1
      `,[key]);
      const row=existing.rows[0];
      if(existing.rows.length!==1||!row||!HEX.test(row.fingerprint))
        throw new Error(FAILURE);
      if(row.fingerprint!==fingerprint)return {decision:'conflict'};
      if(row.status==='RESERVED'&&row.provider_ref===null)
        return {decision:'in_flight'};
      if(row.status==='ACCEPTED'&&
         typeof row.provider_ref==='string'&&REF.test(row.provider_ref))
        return {decision:'accepted',providerRef:row.provider_ref};
      throw new Error(FAILURE);
    }catch{
      // Unknown COMMIT/connection outcomes are NEVER a reason to send again.
      throw new Error(FAILURE);
    }
  }

  /**
   * CAS finalization. Called only after the approved provider has returned
   * an authenticated accepted receipt; repeated ACKs are harmless. If this
   * write fails, the reservation stays RESERVED and requires reconciliation.
   */
  async recordAccepted(
    key:unknown,fingerprint:unknown,providerRef:unknown,
  ):Promise<boolean>{
    assertClaimInput(key,fingerprint);
    if(typeof providerRef!=='string'||!REF.test(providerRef))
      throw new Error(FAILURE);
    try{
      const updated=await this.db.query<{idempotency_key:string}>(`
        UPDATE otp_gateway_delivery_claims
        SET status='ACCEPTED',provider_ref=$3,accepted_at=now()
        WHERE idempotency_key=$1 AND fingerprint=$2
          AND status='RESERVED' AND provider_ref IS NULL
        RETURNING idempotency_key
      `,[key,fingerprint,providerRef]);
      return updated.rows.length===1;
    }catch{
      throw new Error(FAILURE);
    }
  }
}
