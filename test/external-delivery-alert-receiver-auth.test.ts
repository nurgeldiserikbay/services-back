import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acceptAuthenticatedExternalAlertRequest}
 from '../src/modules/notifications/external-delivery-alert-receiver-auth.js';

const bearerToken='receiver-private-token-example-12345';
const config={receiverScope:'staging-kz',bearerToken};
const body=JSON.stringify({alerts:[{
 code:'DUE_BACKLOG',severity:'warning',observed:3,threshold:2,
}]});
const request={
 authorization:'Bearer '+bearerToken,
 contentType:'application/json',
 idempotencyKey:'services-alert-v2-'+'f'.repeat(64),
 rawBody:body,
};

test('receiver requires verified token before any SQL access',async()=>{
 let calls=0;
 const db={query:async()=>{
  calls++;
  return {rows:[{id:'placeholder'}]};
 }} as never;
 for(const input of [
  {...request,authorization:'Bearer wrong-private-token'},
  {...request,authorization:'bearer '+bearerToken},
  {...request,authorization:'Bearer '+bearerToken+'x'},
  {...request,authorization:''},
 ]){
  await assert.rejects(acceptAuthenticatedExternalAlertRequest(
   db,config,input),/external_alert_receiver_unauthorized/);
 }
 assert.equal(calls,0);
});

test('receiver accepts canonical authenticated payload using server-controlled scope',async()=>{
 const queries:{text:string;params:unknown[]}[]=[];
 const db={query:async(text:string,params:unknown[])=>{
  queries.push({text,params});
  return {rows:[{id:'test'}]};
 }} as never;
 assert.equal(await acceptAuthenticatedExternalAlertRequest(db,config,request),
  'accepted');
 assert.equal(queries.length,1);
 assert.equal(queries[0].params[0],config.receiverScope);
 assert.equal(queries[0].params[1],request.idempotencyKey);
 assert.equal(String(queries[0].params[3]).includes(bearerToken),false);
});

test('receiver refuses malformed bodies and headers before touching SQL',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;throw new Error('SQL must not run');}} as never;
 for(const bad of [
  {...request,contentType:'text/plain'},
  {...request,idempotencyKey:'invalid'},
  {...request,rawBody:'{'},
  {...request,rawBody:body+' '},
  {...request,rawBody:JSON.stringify({alerts:[],secret:'private'})},
  {...request,rawBody:'{"alerts":[],"alerts":[]}'},
  {...request,rawBody:' '.repeat(4097)},
 ]){
  await assert.rejects(acceptAuthenticatedExternalAlertRequest(
   db,config,bad),/invalid_external_alert_receiver_request/);
 }
 assert.equal(calls,0);
});

test('receiver never executes accessors on configuration or request',async()=>{
 let reads=0;
 const cfg=Object.defineProperty({...config},'bearerToken',{
  get(){reads++;throw new Error('unsafe');},
 });
 await assert.rejects(acceptAuthenticatedExternalAlertRequest(
  {} as never,cfg,request),/invalid_external_alert_receiver_config/);
 const req=Object.defineProperty({...request},'authorization',{
  get(){reads++;throw new Error('unsafe');},
 });
 await assert.rejects(acceptAuthenticatedExternalAlertRequest(
  {} as never,config,req),/invalid_external_alert_receiver_request/);
 assert.equal(reads,0);
});
