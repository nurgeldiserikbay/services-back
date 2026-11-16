import type {Pool} from 'pg';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {createAdminMfaKeyResolver} from './admin-mfa-key-resolver.js';
import type {PrivateAdminMfaDependencies} from './admin-mfa-private-exchange.js';

/**
 * Build dependencies only at trusted server startup. The vault adapter must
 * resolve an explicitly allowlisted version, never a caller-controlled path.
 * No HTTP controller is registered by this factory.
 */
export function createPrivateAdminMfaDependencies(input:Readonly<{
 pool:Pick<Pool,'connect'>;
 accountSessionHmacKey:string|undefined;
 adminSessionHmacKey:string|undefined;
 transportKey:string|undefined;
 allowedTotpVersions:readonly string[];
 readTotpKey:(version:string)=>Promise<Buffer|null>;
}>):PrivateAdminMfaDependencies{
 if(!input||!input.pool||typeof input.pool.connect!=='function')
  throw new Error('invalid_admin_mfa_pool');
 const accountSessionPepper=requireSecret(input.accountSessionHmacKey);
 const adminSessionPepper=requireSecret(input.adminSessionHmacKey);
 const transportKey=requireSecret(input.transportKey);
 if(accountSessionPepper.equals(adminSessionPepper)||
    accountSessionPepper.equals(transportKey)||
    adminSessionPepper.equals(transportKey))
  throw new Error('admin_mfa_key_reuse');
 const vaultResolver=createAdminMfaKeyResolver(
  input.readTotpKey,input.allowedTotpVersions,
 );
 const resolveTotpKey=async(version:string):Promise<Buffer|null>=>{
  const key=await vaultResolver(version);
  if(!key)return null;
  // Encryption material must never share a domain with any signing or
  // transport credential. Refuse the key instead of decrypting with it.
  if(key.equals(accountSessionPepper)||
     key.equals(adminSessionPepper)||
     key.equals(transportKey)){
   // vaultResolver returns an owned copy; erase rejected key material.
   key.fill(0);
   return null;
  }
  return key;
 };
 return Object.freeze({
  pool:input.pool,
  accountSessionPepper,
  adminSessionPepper,
  resolveTotpKey,
 });
}
