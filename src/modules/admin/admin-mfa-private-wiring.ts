import type {DatabasePool} from '../../platform/database/database.pool.js';
import {adminMfaPoolAdapter} from './admin-mfa-database-adapter.js';
import {createPrivateAdminMfaDependencies} from './admin-mfa-private-dependencies.js';
import type {PrivateAdminMfaDependencies} from './admin-mfa-private-exchange.js';

/**
 * Trusted composition root for private MFA. No environment-derived vault
 * paths, no request-provided key material and no second PostgreSQL pool.
 * The deployment must explicitly supply the vault reader and allowed
 * versions. This function does not register or enable an HTTP endpoint.
 */
export function wirePrivateAdminMfa(input:Readonly<{
 database:Pick<DatabasePool,'connectForAdminMfa'>;
 accountSessionHmacKey:string|undefined;
 adminSessionHmacKey:string|undefined;
 transportKey:string|undefined;
 allowedTotpVersions:readonly string[];
 readTotpKey:(version:string)=>Promise<Buffer|null>;
}>):PrivateAdminMfaDependencies{
 if(!input||!input.database)throw new Error('admin_mfa_database_unavailable');
 return createPrivateAdminMfaDependencies({
  pool:adminMfaPoolAdapter(input.database),
  accountSessionHmacKey:input.accountSessionHmacKey,
  adminSessionHmacKey:input.adminSessionHmacKey,
  transportKey:input.transportKey,
  allowedTotpVersions:input.allowedTotpVersions,
  readTotpKey:input.readTotpKey,
 });
}
