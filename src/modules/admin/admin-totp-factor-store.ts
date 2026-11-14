import type {PoolClient} from 'pg';
import {openAdminTotpSecret,sealAdminTotpSecret} from './admin-totp-secret.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION=/^[A-Za-z0-9_-]{1,64}$/;

/**
 * Server-only factor persistence. Key material must be supplied by a vault.
 * Provisioning is intentionally separated from activation and from login.
 */
export async function provisionAdminTotpFactor(
 db:Pick<PoolClient,'query'>,
 staffId:string,
 secret:Buffer,
 keyVersion:string,
 encryptionKey:Buffer,
):Promise<boolean>{
 if(typeof staffId!=='string'||!UUID.test(staffId)||
    typeof keyVersion!=='string'||!VERSION.test(keyVersion))
  return false;
 if(!Buffer.isBuffer(secret)||secret.length<20||secret.length>128||
    !Buffer.isBuffer(encryptionKey)||encryptionKey.length!==32)
  return false;
 const envelope=sealAdminTotpSecret(secret,staffId,encryptionKey);
 const result=await db.query<{staff_id:string}>(`
  INSERT INTO platform_admin_totp_factors
    (staff_id,encrypted_secret,key_version)
  SELECT staff.id,$2,$3
  FROM platform_admin_staff staff
  JOIN users usr ON usr.id=staff.user_id
  WHERE staff.id=$1::uuid AND staff.disabled_at IS NULL
    AND usr.status='ACTIVE'
    AND staff.role IN ('owner','admin','operator','auditor')
    AND EXISTS (SELECT 1 FROM platform_admin_grants grants
      WHERE grants.staff_id=staff.id)
  ON CONFLICT (staff_id) DO NOTHING
  RETURNING staff_id::text
 `,[staffId,envelope,keyVersion]);
 if(!result||!Array.isArray(result.rows)||result.rows.length>1||
    (result.rows.length===1&&
     (typeof result.rows[0]?.staff_id!=='string'||
      result.rows[0].staff_id.toLowerCase()!==staffId.toLowerCase())))
  throw new Error('admin_totp_provision_unavailable');
 return result.rows.length===1;
}

/**
 * Only activated, non-disabled factors are usable for MFA.
 * Missing/invalid key versions fail closed. Caller must zeroize returned
 * secret when finished and avoid logging it.
 */
export async function loadActiveAdminTotpFactor(
 db:Pick<PoolClient,'query'>,
 staffId:string,
 resolveKey:(version:string)=>Promise<Buffer|null>,
):Promise<Buffer|null>{
 if(typeof staffId!=='string'||!UUID.test(staffId)||
    typeof resolveKey!=='function')return null;
 const result=await db.query<{encrypted_secret:string;key_version:string}>(`
  SELECT factor.encrypted_secret,factor.key_version
  FROM platform_admin_totp_factors factor
  JOIN platform_admin_staff staff ON staff.id=factor.staff_id
  JOIN users usr ON usr.id=staff.user_id
  WHERE factor.staff_id=$1::uuid AND factor.activated_at IS NOT NULL
    AND factor.disabled_at IS NULL AND staff.disabled_at IS NULL
    AND usr.status='ACTIVE'
    AND staff.role IN ('owner','admin','operator','auditor')
    AND EXISTS (SELECT 1 FROM platform_admin_grants grants
      WHERE grants.staff_id=staff.id)
  FOR SHARE OF factor
 `,[staffId]);
 if(!result||!Array.isArray(result.rows)||result.rows.length>1)
  throw new Error('admin_totp_factor_unavailable');
 if(result.rows.length===0)return null;
 const factor=result.rows[0];
 if(!factor||typeof factor.encrypted_secret!=='string'||
    typeof factor.key_version!=='string'||!VERSION.test(factor.key_version))
  throw new Error('admin_totp_factor_unavailable');
 const key=await resolveKey(factor.key_version);
 if(!Buffer.isBuffer(key)||key.length!==32)return null;
 return openAdminTotpSecret(factor.encrypted_secret,staffId,key);
}
