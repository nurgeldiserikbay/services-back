/**
 * Exact HTTPS origin configured by the server. This validation is deliberately
 * independent of Host, Forwarded and X-Forwarded-* request headers.
 * It rejects origin strings containing credentials, paths, whitespace,
 * non-canonical aliases, invalid DNS labels or unsafe ports.
 */
export function isTrustedAppealBffOrigin(value:unknown):value is string{
 if(typeof value!=='string'||value.length>280||
  !/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(value))return false;
 try{
  const parsed=new URL(value);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||
   parsed.pathname!=='/'||parsed.search||parsed.hash||
   !parsed.hostname||parsed.hostname.length>253)return false;
  const labels=parsed.hostname.split('.');
  if(labels.some(label=>label.length<1||label.length>63||
   !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)))return false;
  // Default 443 spelling, uppercase and trailing dots are noncanonical.
  // Keep one exact configured spelling for signature and Origin comparisons.
  if(parsed.origin!==value)return false;
  if(parsed.port&&(!/^\d+$/.test(parsed.port)||
   Number(parsed.port)<1||Number(parsed.port)>65535))return false;
  return true;
 }catch{return false;}
}
