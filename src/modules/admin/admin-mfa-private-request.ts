/**
 * Strict internal MFA exchange payload. It is accepted only after dedicated
 * server-to-server authentication; never expose this schema as a public login.
 * Staff IDs, caller-provided authentication times and key material are forbidden.
 */
export type PrivateAdminMfaRequest=Readonly<{
 account_session_token:string;
 totp_code:string;
}>;

const TOKEN=/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

export function parsePrivateAdminMfaRequest(value:unknown):PrivateAdminMfaRequest|null{
 if(value===null||typeof value!=='object'||Array.isArray(value)||
    Object.getPrototypeOf(value)!==Object.prototype)return null;
 const record=value as Record<string,unknown>;
 if(Object.keys(record).length!==2||
    !Object.hasOwn(record,'account_session_token')||
    !Object.hasOwn(record,'totp_code')||
    typeof record.account_session_token!=='string'||
    !TOKEN.test(record.account_session_token)||
    typeof record.totp_code!=='string'||
    record.totp_code.length>16)return null;
 // The MFA transaction must see malformed codes so it can persist failures
 // and apply the durable lockout. Do not validate the 6 digits here.
 return {
  account_session_token:record.account_session_token,
  totp_code:record.totp_code,
 };
}
