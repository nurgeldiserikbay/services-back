import {createHash,timingSafeEqual} from 'node:crypto';
import type {PoolClient} from 'pg';
import {acceptExternalDeliveryAlertIngress}
 from './external-delivery-alert-receiver-ingress.js';
import type {ExternalDeliveryAlert} from './external-delivery-alerts.js';

/**
 * Explicit receiver-side authentication boundary, for an operator-owned
 * HTTPS controller. Never registered as a public route automatically.
 * Scope is a server-owned config value, never read from request payload.
 */
export type ExternalAlertReceiverAuthConfig=Readonly<{
 receiverScope:string;
 bearerToken:string;
}>;

export type ExternalAlertReceiverRequest=Readonly<{
 authorization:string;
 contentType:string;
 idempotencyKey:string;
 rawBody:string;
}>;

function ownValue(object:object,key:string):unknown{
 const field=Object.getOwnPropertyDescriptor(object,key);
 if(!field||!Object.hasOwn(field,'value'))
  throw new Error('invalid_external_alert_receiver_request');
 return field.value as unknown;
}

export async function acceptAuthenticatedExternalAlertRequest(
 db:Pick<PoolClient,'query'>,
 config:ExternalAlertReceiverAuthConfig,
 request:ExternalAlertReceiverRequest,
):Promise<'accepted'|'duplicate'>{
 if(!config||typeof config!=='object')
  throw new Error('invalid_external_alert_receiver_config');
 const scopeField=Object.getOwnPropertyDescriptor(config,'receiverScope');
 const tokenField=Object.getOwnPropertyDescriptor(config,'bearerToken');
 if(!scopeField||!tokenField||!Object.hasOwn(scopeField,'value')||
    !Object.hasOwn(tokenField,'value'))
  throw new Error('invalid_external_alert_receiver_config');
 const scope:unknown=scopeField.value,secret:unknown=tokenField.value;
 if(typeof scope!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(scope)||
    typeof secret!=='string'||secret.length<16||secret.length>2048||
    !/^[\x21-\x7e]+$/.test(secret))
  throw new Error('invalid_external_alert_receiver_config');

 if(!request||typeof request!=='object')
  throw new Error('invalid_external_alert_receiver_request');
 const auth=ownValue(request,'authorization');
 const contentType=ownValue(request,'contentType');
 const key=ownValue(request,'idempotencyKey');
 const raw=ownValue(request,'rawBody');
 // Fail closed with one generic authentication error: no caller-controlled
 // secret, Authorization value, or malformed input gets reflected.
 if(typeof auth!=='string'||!auth.startsWith('Bearer ')||
    auth.length>2100){
  throw new Error('external_alert_receiver_unauthorized');
 }
 const supplied=auth.slice(7);
 const expectedHash=createHash('sha256').update(secret).digest();
 const suppliedHash=createHash('sha256').update(supplied).digest();
 if(!timingSafeEqual(expectedHash,suppliedHash)||
    supplied.length!==secret.length)
  throw new Error('external_alert_receiver_unauthorized');
 if(contentType!=='application/json'||typeof key!=='string'||
    !/^services-alert-v2-[a-f0-9]{64}$/.test(key)||
    typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>4096)
  throw new Error('invalid_external_alert_receiver_request');

 let value:unknown;
 try{value=JSON.parse(raw);}
 catch{throw new Error('invalid_external_alert_receiver_request');}
 if(!value||typeof value!=='object'||Array.isArray(value)||
    Reflect.ownKeys(value).length!==1)
  throw new Error('invalid_external_alert_receiver_request');
 const alerts=ownValue(value,'alerts');
 if(!Array.isArray(alerts))
  throw new Error('invalid_external_alert_receiver_request');
 // Canonical raw JSON prevents duplicate property names from being silently
 // collapsed by JSON.parse; the sender emits this exact JSON representation.
 if(JSON.stringify(value)!==raw)
  throw new Error('invalid_external_alert_receiver_request');
 return acceptExternalDeliveryAlertIngress(db,scope,key,
  alerts as ReadonlyArray<ExternalDeliveryAlert>);
}
