import type {AccountOtpDispatchMessage} from './account-otp-delivery.port.js';
import {AccountOtpDeliveryUnavailable} from './account-otp-delivery.port.js';
import {ACCOUNT_OTP_TTL_SECONDS} from './account-otp-proof.js';

export type AccountOtpRenderedMessage=Readonly<{
  channel:'EMAIL'|'SMS';
  destination:string;
  subject:string|null;
  text:string;
}>;

/**
 * A pure formatter for approved OTP delivery providers, not an HTTP DTO.
 * Returns ONLY the destination, code-bearing text, and optional email subject;
 * never interpolate challenge ID, account status, provider reference or PII.
 * Do not log its result.
 */
export function renderAccountOtpMessage(message:AccountOtpDispatchMessage):AccountOtpRenderedMessage{
  if(!message||!['EMAIL','SMS'].includes(message.channel)||
    !['SIGN_IN','SIGN_UP'].includes(message.purpose)||
    !['kk','ru'].includes(message.locale)||
    typeof message.destination!=='string'||message.destination.length<3||
    message.destination.length>254||/[\r\n\u0000-\u001f\u007f]/.test(message.destination)||
    typeof message.code!=='string'||!/^[0-9]{6}$/.test(message.code)||
    message.expiresInSeconds!==ACCOUNT_OTP_TTL_SECONDS)
    throw new AccountOtpDeliveryUnavailable();

  const signup=message.purpose==='SIGN_UP';
  const subject=message.locale==='kk'
    ? signup?'Services — тіркелуді растау коды':'Services — кіруді растау коды'
    : signup?'Services — код подтверждения регистрации':'Services — код подтверждения входа';
  const text=message.locale==='kk'
    ? `Services: ${signup?'тіркелу':'кіру'} коды — ${message.code}. Код 5 минут жарамды. Оны ешкімге айтпаңыз.`
    : `Services: код для ${signup?'регистрации':'входа'} — ${message.code}. Код действителен 5 минут. Никому его не сообщайте.`;
  return Object.freeze({
    channel:message.channel,destination:message.destination,
    subject:message.channel==='EMAIL'?subject:null,text,
  });
}
