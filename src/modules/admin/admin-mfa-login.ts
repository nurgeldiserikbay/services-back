import type {Pool} from 'pg';
import {loadActiveAdminTotpFactor} from './admin-totp-factor-store.js';
import {issueAdminSessionInTransaction} from './admin-mfa-transaction.js';

/**
 * Server-side entry point for an ALREADY authenticated primary factor.
 * Resolve encryption keys via a trusted secret manager, not client input.
 * The primary assertion must be minted by the server; do not expose this
 * function directly as a public HTTP route.
 *
 * Note: factor loading precedes the issuance transaction. Disable/revocation
 * checks must be repeated inside the transaction before production use.
 */
export async function loginAdminWithProvisionedTotp(
 pool:Pick<Pool,'connect'>,
 primary:{staffId:string;authenticatedAt:number},
 code:unknown,
 resolveKey:(version:string)=>Promise<Buffer|null>,
 sessionPepper:Buffer,
 now=Date.now(),
):Promise<{token:string;expiresAt:number}|null>{
 if(!primary||typeof primary.staffId!=='string')return null;
 const client=await pool.connect();
 let secret:Buffer|null=null;
 try{
  secret=await loadActiveAdminTotpFactor(client,primary.staffId,resolveKey);
 }finally{
  client.release();
 }
 if(!secret)return null;
 try{
  return await issueAdminSessionInTransaction(
   pool,primary,secret,code,sessionPepper,now,
  );
 }finally{
  secret.fill(0);
 }
}
