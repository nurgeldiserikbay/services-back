import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {parseRequeueHttpPreflight,RequeueHttpPreflightRejected}
 from '../src/modules/notifications/dead-letter-requeue-http-preflight.js';

function fixture(){
 const csrf=randomBytes(32).toString('base64url');
 return {
  deliveryId:randomUUID().toUpperCase(),
  requeueKeyHeader:randomUUID().toUpperCase(),
  rawBody:'{}',
  csrfHeader:csrf,
  sessionExpectedCsrf:csrf,
  expectedOrigin:'https://admin.example.kz',
  origin:'https://admin.example.kz',
  fetchSite:'same-origin',
  contentType:'application/json',
  transportProtocol:'https:',
 };
}

test('requeue preflight accepts only opaque UUID command with server CSRF proof',()=>{
 const input=fixture();
 const cmd=parseRequeueHttpPreflight(input);
 assert.deepEqual(cmd,{
  deliveryId:input.deliveryId.toLowerCase(),
  requeueKey:input.requeueKeyHeader.toLowerCase(),
 });
 assert.ok(Object.isFrozen(cmd));
 assert.deepEqual(parseRequeueHttpPreflight({...input,
  rawBody:'  {  }  ',contentType:'application/json; charset=utf-8'}),cmd);
 assert.equal(Object.keys(cmd).length,2);
});

test('requeue HTTP boundary rejects forged transport, CSRF, key and body fields',()=>{
 const cases:Record<string,unknown>[]=[
  {deliveryId:'bad'},{requeueKeyHeader:'bad'},
  {requeueKeyHeader:[randomUUID()]},
  {requeueKeyHeader:randomUUID()+','+randomUUID()},
  {rawBody:'{"scope":"organization:any"}'},
  {rawBody:'{"actor":"owner"}'},
  {rawBody:'{"retry":true}'},
  {rawBody:'{"deliveryId":"x"}'},
  {rawBody:'{"requeueKey":"x"}'},
  {rawBody:'[]'},{rawBody:''},{rawBody:' '.repeat(33)+'{}'},
  {rawBody:42},{csrfHeader:'bad'},
  {csrfHeader:randomBytes(32).toString('base64url')},
  {sessionExpectedCsrf:randomBytes(32).toString('base64url')},
  {fetchSite:'cross-site'},{fetchSite:'same-site'},
  {fetchSite:null},{origin:'https://evil.example.kz'},
  {expectedOrigin:'http://admin.example.kz',origin:'http://admin.example.kz'},
  {expectedOrigin:'https://admin.example.kz/path'},
  {expectedOrigin:'https://admin.example.kz/'},
  {expectedOrigin:'https://admin.example.kz?x=1'},
  {expectedOrigin:'https://user:pass@admin.example.kz'},
  {transportProtocol:'http:'},
  {contentType:'application/x-www-form-urlencoded'},
  {contentType:'application/json,application/json'},
  {contentType:'text/plain'},
 ];
 for(const partial of cases)
  assert.throws(()=>parseRequeueHttpPreflight({...fixture(),...partial}),
   RequeueHttpPreflightRejected,JSON.stringify(partial));
});

test('requeue preflight denies untrusted or missing verified session proof',()=>{
 for(const expected of [undefined,null,'',randomBytes(16).toString('base64url'),
  randomBytes(32).toString('base64url')+'=']){
  assert.throws(()=>parseRequeueHttpPreflight({
   ...fixture(),sessionExpectedCsrf:expected,
  }),/invalid_requeue_http_preflight/);
 }
});

test('requeue preflight never invokes accessor-backed or inherited transport fields',()=>{
 for(const field of ['deliveryId','requeueKeyHeader','rawBody','csrfHeader',
  'sessionExpectedCsrf','expectedOrigin','origin','fetchSite',
  'contentType','transportProtocol'] as const){
  const input=fixture();
  let getterCalls=0;
  Object.defineProperty(input,field,{
   enumerable:true,configurable:true,
   get(){getterCalls++;throw Error('untrusted_getter_executed');},
  });
  assert.throws(()=>parseRequeueHttpPreflight(input),
   RequeueHttpPreflightRejected,field);
  assert.equal(getterCalls,0,field);
 }
 const inherited=Object.create(fixture()) as ReturnType<typeof fixture>;
 assert.throws(()=>parseRequeueHttpPreflight(inherited),
  RequeueHttpPreflightRejected);
 const derived=Object.assign(Object.create({evil:true}),fixture());
 assert.throws(()=>parseRequeueHttpPreflight(derived),
  RequeueHttpPreflightRejected);
});

test('requeue preflight rejects extra fields and accepts plain null prototype data',()=>{
 const input=fixture();
 const withActor=Object.assign({},input,{actor:'admin'});
 assert.throws(()=>parseRequeueHttpPreflight(withActor),
  RequeueHttpPreflightRejected);
 const withScope=Object.assign({},input,{organizationScope:'organization:any'});
 assert.throws(()=>parseRequeueHttpPreflight(withScope),
  RequeueHttpPreflightRejected);
 const extraSymbol=Object.assign({},input);
 Object.defineProperty(extraSymbol,Symbol('hidden'),{value:true});
 assert.throws(()=>parseRequeueHttpPreflight(extraSymbol),
  RequeueHttpPreflightRejected);
 const plain=Object.assign(Object.create(null),input);
 const command=parseRequeueHttpPreflight(plain);
 assert.equal(command.deliveryId,input.deliveryId.toLowerCase());
 assert.equal(command.requeueKey,input.requeueKeyHeader.toLowerCase());
});
