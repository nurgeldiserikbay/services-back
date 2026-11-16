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
 const descriptors=Object.getOwnPropertyDescriptors(value);
 const keys=Reflect.ownKeys(value);
 if(keys.length!==2||
    !Object.hasOwn(descriptors,'account_session_token')||
    !Object.hasOwn(descriptors,'totp_code'))return null;
 const token=descriptors.account_session_token;
 const code=descriptors.totp_code;
 // Never execute caller-defined getters or accept hidden symbol properties.
 if(!token||!Object.hasOwn(token,'value')||
    !code||!Object.hasOwn(code,'value')||
    typeof token.value!=='string'||!TOKEN.test(token.value)||
    typeof code.value!=='string'||code.value.length>16)return null;
 // The MFA transaction must see malformed codes so it can persist failures
 // and apply the durable lockout. Do not validate the 6 digits here.
 return {
  account_session_token:token.value,
  totp_code:code.value,
 };
}
