import type {Pool} from 'pg';

/**
 * @deprecated Disabled legacy raw-secret MFA entry point.
 *
 * A caller-supplied TOTP seed cannot establish that the code belongs to the
 * encrypted, activated factor stored for this staff member. Merely checking
 * that some active factor exists leaves a second-factor substitution bypass.
 *
 * New integrations MUST use loginAdminWithProvisionedTotp, which obtains
 * the enrolled secret from protected storage under a transaction row lock.
 * Keep this fail-closed shim only to avoid silently reintroducing the bypass
 * through an old import. It never connects to the database or issues tokens.
 */
export async function issueAdminSessionInTransaction(
 _pool:Pick<Pool,'connect'>,
 _primary:{staffId:string;authenticatedAt:number},
 _totpSecret:Buffer,
 _totpCode:unknown,
 _pepper:Buffer,
 _now=Date.now(),
):Promise<{token:string;expiresAt:number}|null>{
 return null;
}
