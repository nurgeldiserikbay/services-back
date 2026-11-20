import 'reflect-metadata';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {GuestCompletionHttpController} from
 '../src/modules/guest-requests/guest-completion-http.controller.js';
import {GuestOtpDispatchService} from
 '../src/modules/guest-requests/guest-otp-dispatch.service.js';
import {GuestChallengeVerificationService} from
 '../src/modules/guest-requests/guest-challenge-verification.service.js';
import {GuestCompletionService} from
 '../src/modules/requests/guest-completion.service.js';

const id=randomUUID(),challenge=randomUUID();
const read=randomBytes(32).toString('base64url');
const write=randomBytes(32).toString('base64url');
test('real Nest guest completion HTTP stays disabled, binds ingress proof and uses separated OTP/write proof',async()=>{
 const original=process.env.SERVICES_ENABLE_GUEST_COMPLETION_HTTP;
 const priorKey=process.env.GUEST_NETWORK_ATTESTATION_KEY;
 let dispatchCalls=0,verifyCalls=0,completionCalls=0;
 const key=randomBytes(32),digest=randomBytes(32).toString('hex');
 process.env.GUEST_NETWORK_ATTESTATION_KEY=key.toString('base64');
 delete process.env.SERVICES_ENABLE_GUEST_COMPLETION_HTTP;
 const dispatch={dispatchCompleteRequest:async(
  request:string,token:string,locale:string,network:string)=>{
  dispatchCalls++;
  assert.equal(request,id);assert.equal(token,read);
  assert.equal(locale,'kk');assert.equal(network,digest);
  return {challengeId:challenge,expiresInSeconds:600};
 }};
 const verify={verifyCompleteRequest:async(
  request:string,challengeId:string,code:string)=>{
  verifyCalls++;assert.equal(request,id);assert.equal(challengeId,challenge);
  assert.equal(code,'123456');
  return {guestCapability:write,expiresInSeconds:900};
 }};
 const completion={confirm:async(
  request:string,token:string,version:number)=>{
  completionCalls++;assert.equal(request,id);assert.equal(token,write);
  assert.equal(version,2);
  return {id,state:'completed',version:3};
 }};
 @Module({controllers:[GuestCompletionHttpController],providers:[
  {provide:GuestOtpDispatchService,useValue:dispatch},
  {provide:GuestChallengeVerificationService,useValue:verify},
  {provide:GuestCompletionService,useValue:completion},
 ]})
 class IsolatedModule{}
 const app=await NestFactory.create(IsolatedModule,{logger:false});
 app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');
 const root=(await app.getUrl())+'/v1/guest-requests/'+id+'/completion';
 const send=(route:string,headers:Record<string,string>,body:string)=>fetch(
  root+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},
   body,redirect:'manual'});
 const stamp=String(Date.now());
 const mac=createHmac('sha256',key)
  .update('services-otp-network:v1\n').update(digest).update('\n')
  .update(stamp).digest('hex');
 const proof='v1.'+digest+'.'+stamp+'.'+mac;
 try{
  const off=await send('/challenges',
   {'guest-capability':read,'x-services-network-proof':proof},'{"locale":"kk"}');
  assert.equal(off.status,404);
  assert.equal(dispatchCalls,0);
  const offWrite=await send('/confirm',
   {'guest-completion-capability':write,'If-Match':'"2"'},'{}');
  assert.equal(offWrite.status,404);
  assert.equal(completionCalls,0);
  const offVerify=await send('/challenges/'+challenge+'/verify',{},
   '{"code":"123456"}');
  assert.equal(offVerify.status,404);
  assert.equal(verifyCalls,0);
  // No truthy alias may unintentionally activate the protected transport.
  for(const flag of ['true','1','ENABLED',' enabled ','yes']){
   process.env.SERVICES_ENABLE_GUEST_COMPLETION_HTTP=flag;
   const denied=await send('/challenges',
    {'guest-capability':read,'x-services-network-proof':proof},'{"locale":"kk"}');
   assert.equal(denied.status,404,'unexpected activation for '+flag);
  }
  assert.equal(dispatchCalls,0);
  assert.equal(verifyCalls,0);
  assert.equal(completionCalls,0);
  process.env.SERVICES_ENABLE_GUEST_COMPLETION_HTTP='enabled';

  const invalidIdRoot=(await app.getUrl())+'/v1/guest-requests/not-a-uuid/completion';
  const invalidIssue=await fetch(invalidIdRoot+'/challenges',{
   method:'POST',headers:{'Content-Type':'application/json',
    'guest-capability':read,'x-services-network-proof':proof},
   body:'{"locale":"kk"}'});
  assert.equal(invalidIssue.status,404);
  const invalidConfirm=await fetch(invalidIdRoot+'/confirm',{
   method:'POST',headers:{'Content-Type':'application/json',
    'guest-completion-capability':write,'If-Match':'"2"'},body:'{}'});
  assert.equal(invalidConfirm.status,404);
  const invalidVerify=await fetch(invalidIdRoot+'/challenges/'+challenge+'/verify',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:'{"code":"123456"}'});
  assert.equal(invalidVerify.status,401);
  assert.equal(dispatchCalls,0);
  assert.equal(verifyCalls,0);
  assert.equal(completionCalls,0);

  const noIngress=await send('/challenges',{'guest-capability':read},'{"locale":"kk"}');
  assert.equal(noIngress.status,503);assert.equal(dispatchCalls,0);
  // A bad or attacker-supplied network proof must fail before issuing an OTP.
  for(const header of ['', 'invalid',proof+'0']){
   const denied=await send('/challenges',
    {'guest-capability':read,'x-services-network-proof':header},'{"locale":"kk"}');
   assert.equal(denied.status,503);
  }
  assert.equal(dispatchCalls,0);
  const badInput=await send('/challenges',
   {'guest-capability':read,'x-services-network-proof':proof},
   '{"locale":"kk","contact":"forged@example.test"}');
  assert.equal(badInput.status,404);assert.equal(dispatchCalls,0);
  const issued=await send('/challenges',
   {'guest-capability':read,'x-services-network-proof':proof},'{"locale":"kk"}');
  assert.equal(issued.status,202);
  assert.deepEqual(await issued.json(),{challenge_id:challenge});
  assert.match(issued.headers.get('cache-control')??'',/no-store/);
  assert.equal(dispatchCalls,1);

  const wrongCode=await send('/challenges/'+challenge+'/verify',{},'{"code":"12"}');
  assert.equal(wrongCode.status,401);assert.equal(verifyCalls,0);
  const verified=await send('/challenges/'+challenge+'/verify',{},'{"code":"123456"}');
  assert.equal(verified.status,200);
  const verifiedBody=await verified.json() as Record<string,unknown>;
  assert.equal(verifiedBody.guest_capability,write);
  assert.equal(typeof verifiedBody.expires_at,'string');
  assert.match(verified.headers.get('cache-control')??'',/no-store/);
  assert.equal(verifyCalls,1);
  // Reject malformed codes and forged challenge IDs before verification.
  for(const [challengeId,body] of [
   [challenge,'{"code":123456}'],
   [challenge,'{"code":"123456","actor":"guest"}'],
   [randomUUID(),'{"code":"12"}'],
  ]){
   const denied=await send('/challenges/'+challengeId+'/verify',{},body);
   assert.equal(denied.status,401);
  }
  assert.equal(verifyCalls,1);

  const missingWrite=await send('/confirm',{'If-Match':'"2"'},'{}');
  assert.equal(missingWrite.status,404);
  const weak=await send('/confirm',
   {'guest-completion-capability':write,'If-Match':'W/"2"'},'{}');
  assert.equal(weak.status,409);
  const forgedBody=await send('/confirm',
   {'guest-completion-capability':write,'If-Match':'"2"'},'{"actor":"guest"}');
  assert.equal(forgedBody.status,409);assert.equal(completionCalls,0);
  // Strong ETags only, with bounded positive DB-safe version numbers.
  for(const version of ['2','"0"','"2147483647"','"9999999999"','"2", "3"']){
   const denied=await send('/confirm',
    {'guest-completion-capability':write,'If-Match':version},'{}');
   assert.equal(denied.status,409,'unsafe If-Match '+version);
  }
  assert.equal(completionCalls,0);
  const completed=await send('/confirm',
   {'guest-completion-capability':write,'If-Match':'"2"'},'{}');
  assert.equal(completed.status,200);
  assert.deepEqual(await completed.json(),{id,state:'completed',version:3});
  assert.match(completed.headers.get('cache-control')??'',/no-store/);
  assert.equal(completionCalls,1);
 }finally{
  await app.close();
  if(original===undefined)delete process.env.SERVICES_ENABLE_GUEST_COMPLETION_HTTP;
  else process.env.SERVICES_ENABLE_GUEST_COMPLETION_HTTP=original;
  if(priorKey===undefined)delete process.env.GUEST_NETWORK_ATTESTATION_KEY;
  else process.env.GUEST_NETWORK_ATTESTATION_KEY=priorKey;
 }
});
