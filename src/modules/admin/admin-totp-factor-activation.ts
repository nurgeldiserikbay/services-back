import type {PoolClient} from 'pg';
import {openAdminTotpSecret} from './admin-totp-secret.js';
import {verifyAdminTotp} from './admin-totp.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION=/^[A-Za-z0-9_-]{1,64}$/;

/**
 * Activate an already-provisioned factor after proof of possession.
 * The caller MUST independently authenticate the staff member and enforce
 * rate limits before calling. This must not be exposed directly to a browser.
 * Run in a transaction; only one pending factor per staff is permitted.
 */
export async function activateAdminTotpFactor(
 db:Pick<PoolClient,'query'>,
 staffId:unknown,
 code:unknown,
 resolveKey:(version:string)=>Promise<Buffer|null>,
 now=Date.now(),
):Promise<boolean>{
 if(typeof staffId!=='string'||!UUID.test(staffId)||
    typeof code!=='string'||!/^[0-9]{6}$/.test(code)||
    !Number.isSafeInteger(now)||now<0)return false;
 const result=await db.query<{encrypted_secret:string;key_version:string}>(`
  SELECT factor.encrypted_secret,factor.key_version
  FROM platform_admin_totp_factors factor
  JOIN platform_admin_staff staff ON staff.id=factor.staff_id
  JOIN users usr ON usr.id=staff.user_id
  WHERE factor.staff_id=$1::uuid AND factor.activated_at IS NULL
    AND factor.disabled_at IS NULL AND staff.disabled_at IS NULL
    AND usr.status='ACTIVE'
  FOR UPDATE OF factor
 `,[staffId]);
 if(!result||!Array.isArray(result.rows)||result.rows.length>1)
  throw new Error('admin_totp_activation_unavailable');
 if(result.rows.length===0)return false;
 const factor=result.rows[0];
 if(!factor||typeof factor.encrypted_secret!=='string'||
    typeof factor.key_version!=='string'||!VERSION.test(factor.key_version))
  throw new Error('admin_totp_activation_unavailable');
 const key=await resolveKey(factor.key_version);
 if(!Buffer.isBuffer(key)||key.length!==32)return false;
 const secret=openAdminTotpSecret(factor.encrypted_secret,staffId,key);
 if(!secret)return false;
 let counter:number|null;
 try{counter=verifyAdminTotp(secret,code,now,-1);}
 finally{secret.fill(0);}
 if(counter===null)return false;
 const updated=await db.query<{staff_id:string}>(`
  UPDATE platform_admin_totp_factors
  SET activated_at=to_timestamp($2::double precision/1000)
  WHERE staff_id=$1::uuid AND activated_at IS NULL AND disabled_at IS NULL
  RETURNING staff_id::text
 `,[staffId,now]);
 if(!updated||!Array.isArray(updated.rows)||updated.rows.length>1)
  throw new Error('admin_totp_activation_unavailable');
 return updated.rows.length===1&&
  updated.rows[0]?.staff_id?.toLowerCase()===staffId.toLowerCase();
}
