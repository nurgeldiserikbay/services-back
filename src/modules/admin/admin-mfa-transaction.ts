import type {Pool,PoolClient} from 'pg';
import {issueAdminSessionAfterTotp} from './admin-mfa-session.js';
import {isAdminMfaLocked,recordAdminMfaFailure} from './admin-mfa-attempts.js';

/**
 * Transaction boundary for a trusted MFA login service.
 * Only return the privileged bearer after PostgreSQL confirms COMMIT.
 * This is deliberately NOT an HTTP endpoint or primary-factor verifier.
 */
export async function issueAdminSessionInTransaction(
 pool:Pick<Pool,'connect'>,
 primary:{staffId:string;authenticatedAt:number},
 totpSecret:Buffer,
 totpCode:unknown,
 pepper:Buffer,
 now=Date.now(),
):Promise<{token:string;expiresAt:number}|null>{
 const client:PoolClient=await pool.connect();
 let committed=false;
 let began=false;
 try{
  await client.query('BEGIN');
  began=true;
  // Serialize concurrent attempts for this staff identity, including the
  // first attempt before a lockout row exists. The lock is transaction-scoped.
  if(typeof primary?.staffId==='string' &&
     /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(primary.staffId)){
   await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 104729))",
    [primary.staffId],
   );
  }
  if(await isAdminMfaLocked(client,primary?.staffId,now)){
   await client.query('ROLLBACK');
   began=false;
   return null;
  }
  const session=await issueAdminSessionAfterTotp(
   client,primary,totpSecret,totpCode,pepper,now,
  );
  if(!session){
   // Commit the failure independently of session issuance. Otherwise a
   // ROLLBACK would discard the lockout counter and permit unlimited guesses.
   // Invalid primary identities never produce a valid staff row in the upsert.
   await recordAdminMfaFailure(client,primary?.staffId,now);
   await client.query('COMMIT');
   committed=true;
   began=false;
   return null;
  }
  await client.query('COMMIT');
  committed=true;
  began=false;
  return session;
 }catch(error){
  if(began&&!committed){
   try{await client.query('ROLLBACK');}catch{/* retain original failure */}
  }
  throw error;
 }finally{
  client.release();
 }
}
