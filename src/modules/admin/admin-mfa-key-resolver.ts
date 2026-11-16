/**
 * Immutable, allowlisted versioned key resolver for a trusted vault adapter.
 * The caller supplies keys from the secret manager; neither HTTP requests nor
 * database factor records can select an arbitrary secret name or environment
 * variable. Never persist or log the returned key material.
 */
export function createAdminMfaKeyResolver(
 readVersion:(version:string)=>Promise<Buffer|null>,
 allowedVersions:readonly string[],
):(version:string)=>Promise<Buffer|null>{
 if(typeof readVersion!=='function'||!Array.isArray(allowedVersions)||
    allowedVersions.length===0||allowedVersions.length>16||
    allowedVersions.some(version=>typeof version!=='string'||
      !/^[A-Za-z0-9_-]{1,64}$/.test(version))||
    new Set(allowedVersions).size!==allowedVersions.length)
  throw new Error('invalid_admin_mfa_key_configuration');
 const allowed=new Set(allowedVersions);
 return async(version:string):Promise<Buffer|null>=>{
  if(typeof version!=='string'||!allowed.has(version))return null;
  const key=await readVersion(version);
  if(!Buffer.isBuffer(key)||key.length!==32)return null;
  // Return a separate buffer: TOTP decrypt must not mutate the vault cache.
  return Buffer.from(key);
 };
}
