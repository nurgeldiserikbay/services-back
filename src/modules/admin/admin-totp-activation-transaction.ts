import type {Pool,PoolClient} from 'pg';
import {activateAdminTotpFactor} from './admin-totp-factor-activation.js';

/**
 * Transaction boundary for trusted TOTP enrollment.
 * The primary factor must already be authenticated by the caller.
 * Enrollment proof consumption and activation are atomic.
 */
export async function activateAdminTotpInTransaction(
 pool:Pick<Pool,'connect'>,
 staffId:string,
 code:unknown,
 resolveKey:(version:string)=>Promise<Buffer|null>,
 now=Date.now(),
):Promise<boolean>{
 const client:PoolClient=await pool.connect();
 let began=false;
 try{
  await client.query('BEGIN');
  began=true;
  // Serialize enrollment with MFA issuance and account lockout checks.
  await client.query(
   'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 104729))',
   [staffId],
  );
  const activated=await activateAdminTotpFactor(
   client,staffId,code,resolveKey,now,
  );
  if(!activated){
   await client.query('ROLLBACK');
   began=false;
   return false;
  }
  await client.query('COMMIT');
  began=false;
  return true;
 }catch(error){
  if(began){
   try{await client.query('ROLLBACK');}catch{/* preserve original failure */}
  }
  throw error;
 }finally{
  client.release();
 }
}
