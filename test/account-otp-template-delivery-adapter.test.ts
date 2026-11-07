import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {AccountOtpTemplateDeliveryAdapter}
 from '../src/modules/identity/account-otp-template-delivery.adapter.js';
import {AccountOtpDeliveryUnavailable}
 from '../src/modules/identity/account-otp-delivery.port.js';

const challengeId=randomUUID();
const msg={
  challengeId,channel:'EMAIL' as const,purpose:'SIGN_IN' as const,
  destination:'account@example.test',code:'012345',expiresInSeconds:300,
  locale:'kk' as const,
};
test('approved adapter passes only rendered message and opaque stable provider key',async()=>{
 const key=randomBytes(32);
 const calls:{rendered:unknown;dedupe:string}[]=[];
 const sender=async(rendered:unknown,dedupe:string)=>{
  calls.push({rendered,dedupe});
  return {accepted:true,providerRef:'receipt_12345678',debug:'secret'}; // never forwarded
 };
 const adapter=new AccountOtpTemplateDeliveryAdapter(sender,key);
 const a=await adapter.deliver(msg);
 const b=await adapter.deliver(msg);
 assert.deepEqual(a,{accepted:true,providerRef:'receipt_12345678'});
 assert.deepEqual(b,a);
 assert.equal(calls.length,2);
 assert.equal(calls[0].dedupe,calls[1].dedupe);
 assert.match(calls[0].dedupe,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(calls[0].dedupe.includes(challengeId),false);
 assert.deepEqual(Object.keys(calls[0].rendered as object).sort(),
  ['channel','destination','subject','text']);
 assert.equal(JSON.stringify(calls[0].rendered).includes(challengeId),false);
 assert.equal(JSON.stringify(calls[0].rendered).includes('012345'),true);
 const different=new AccountOtpTemplateDeliveryAdapter(sender,randomBytes(32));
 await different.deliver(msg);
 assert.notEqual(calls[0].dedupe,calls[2].dedupe);
 await adapter.deliver({...msg,challengeId:randomUUID()});
 assert.notEqual(calls[0].dedupe,calls[3].dedupe);
});
test('SMS and Russian sign up require provider to receive locale-specific text only',async()=>{
 let observed:unknown;
 const adapter=new AccountOtpTemplateDeliveryAdapter(async(rendered)=>{
  observed=rendered;
  return {accepted:true,providerRef:null};
 },randomBytes(32));
 await adapter.deliver({...msg,channel:'SMS',destination:'+77001234567',
  purpose:'SIGN_UP',locale:'ru'});
 assert.deepEqual(Object.keys(observed as object).sort(),['channel','destination','subject','text']);
 assert.equal((observed as {subject:unknown}).subject,null);
 assert.match((observed as {text:string}).text,/регистрации/);
});
test('invalid provider response, thrown secrets and rejected sends fail generically',async()=>{
 for(const result of [
  {accepted:false,providerRef:null},{accepted:true,providerRef:'invalid!'},
  {accepted:true,providerRef:'valid_ref_123',contact:'secret'},
  null,
 ]){
  const adapter=new AccountOtpTemplateDeliveryAdapter(async()=>result,randomBytes(32));
  await assert.rejects(adapter.deliver(msg),AccountOtpDeliveryUnavailable);
 }
 const thrown=new AccountOtpTemplateDeliveryAdapter(async()=>{
  throw new Error('secret contact: account@example.test');
 },randomBytes(32));
 await assert.rejects(thrown.deliver(msg),error=>{
  assert.ok(error instanceof AccountOtpDeliveryUnavailable);
  assert.equal(String(error).includes('account@example.test'),false);
  return true;
 });
});
test('adapter refuses unsafe keys and malformed challenge before any vendor call',async()=>{
 const send=async()=>({accepted:true,providerRef:null});
 for(const key of [Buffer.alloc(32),Buffer.alloc(16)]){
  assert.throws(()=>new AccountOtpTemplateDeliveryAdapter(send,key),
   AccountOtpDeliveryUnavailable);
 }
 let hits=0;
 const adapter=new AccountOtpTemplateDeliveryAdapter(async()=>{hits++;return {accepted:true,providerRef:null};},randomBytes(32));
 for(const bad of [{...msg,challengeId:'invalid'},{...msg,code:'123'},
  {...msg,locale:'en'}]){
  await assert.rejects(adapter.deliver(bad as never),AccountOtpDeliveryUnavailable);
 }
 assert.equal(hits,0);
});
