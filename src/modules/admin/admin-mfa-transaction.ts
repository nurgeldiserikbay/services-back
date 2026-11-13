import type {Pool,PoolClient} from 'pg';
import {issueAdminSessionAfterTotp} from './admin-mfa-session.js';
import {isAdminMfaLocked} from './admin-mfa-attempts.js';

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
  if(await isAdminMfaLocked(client,primary?.staffId,now)){
   await client.query('ROLLBACK');
   began=false;
   return null;
  }
  const session=await issueAdminSessionAfterTotp(
   client,primary,totpSecret,totpCode,pepper,now,
  );
  if(!session){
   await client.query('ROLLBACK');
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
