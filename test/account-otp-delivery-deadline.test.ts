import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  deliverAccountOtpWithinDeadline,
} from '../src/modules/identity/account-otp-delivery-deadline.js';
import {AccountOtpDeliveryUnavailable}
 from '../src/modules/identity/account-otp-delivery.port.js';

const message={
 challengeId:'a59e3b8b-72ae-4ed8-91f9-51484d5f8cf0',
 channel:'EMAIL' as const,purpose:'SIGN_IN' as const,
 destination:'provider-test@example.com',code:'123456',
 expiresInSeconds:300,locale:'kk' as const,
};
test('account OTP delivery deadline passes through a prompt verified provider receipt',async()=>{
 const receipt=await deliverAccountOtpWithinDeadline({
  deliver:async()=>({accepted:true,providerRef:'test_12345678'}),
 },message as never,500);
 assert.deepEqual(receipt,{accepted:true,providerRef:'test_12345678'});
});
test('hanging provider times out; late accepted response cannot turn rejection into acceptance',async()=>{
 let resolve!: (receipt:{accepted:boolean;providerRef:string|null})=>void;
 const later=new Promise<{accepted:boolean;providerRef:string|null}>(r=>{resolve=r;});
 const invocation=deliverAccountOtpWithinDeadline({
  deliver:async()=>later,
 },message as never,12);
 await assert.rejects(invocation,AccountOtpDeliveryUnavailable);
 resolve({accepted:true,providerRef:'late_12345678'});
 await later;
 await assert.rejects(invocation,AccountOtpDeliveryUnavailable);
});
test('deadline enforces bounded values and fails closed on throwing provider',async()=>{
 for(const deadline of [0,-1,8001,1.5,NaN,Infinity]){
  await assert.rejects(deliverAccountOtpWithinDeadline({
   deliver:async()=>({accepted:true,providerRef:null}),
  },message as never,deadline),AccountOtpDeliveryUnavailable);
 }
 await assert.rejects(deliverAccountOtpWithinDeadline({
  deliver:async()=>{throw new Error('provider secret failure');},
 },message as never,100),/provider secret failure/);
});
