import type {Pool,PoolClient} from 'pg';
import type {DatabasePool} from '../../platform/database/database.pool.js';

/**
 * Exposes only the connection shape required by the existing atomic MFA
 * login primitive. DatabasePool remains the sole owner of the underlying
 * bounded PostgreSQL pool and its shutdown lifecycle.
 */
export function adminMfaPoolAdapter(
 database:Pick<DatabasePool,'connectForAdminMfa'>,
):Pick<Pool,'connect'>{
 if(!database||typeof database.connectForAdminMfa!=='function')
  throw new Error('admin_mfa_database_unavailable');
 return {
  connect:():Promise<PoolClient>=>database.connectForAdminMfa(),
 } as Pick<Pool,'connect'>;
}
