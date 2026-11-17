import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {CancellationCommandRejected,parseCancellationCommand,
  parseCancellationIdempotencyHeader,parseCancellationRawJsonBody,
  assertCancellationTransportHeaders,assertCancellationSessionCsrf,
  parseCancellationPreflight} from
  '../src/modules/requests/cancellation-command-contract.js';

const request='11111111-1111-4111-8111-111111111111';
const key='Cancel_2026_abcdef012345';

test('accepts one bounded version and opaque idempotency key only',()=>{
  const result=parseCancellationCommand(request,{expectedVersion:3},key);
  assert.deepEqual(result,{requestId:request,expectedVersion:3,
    idempotencyKey:key});
  assert.equal(Object.isFrozen(result),true);
  assert.equal(parseCancellationIdempotencyHeader(key),key);
});
test('rejects actor/seller/reliability overrides, malformed and replay-unsafe bodies',()=>{
  for(const body of [
    {},null,[],{expectedVersion:0},{expectedVersion:-1},
    {expectedVersion:1.2},{expectedVersion:'1'},
    {expectedVersion:1,actor:'SELLER'},
    {expectedVersion:1,customerPenaltySuspended:true},
    {expectedVersion:1,approvalId:'FAKE'},
    {expectedVersion:1,reliabilityWeight:0},
  ]){
    assert.throws(()=>parseCancellationCommand(request,body,key),
      CancellationCommandRejected);
  }
});
test('rejects missing, short, long, multi-valued and unsafe keys',()=>{
  for(const value of [undefined,null,[],['a','b'],'',
    'short','a'.repeat(129),'abc,def','contains spaces','a/b/c',
  ]){
    assert.throws(()=>parseCancellationIdempotencyHeader(value),
      CancellationCommandRejected);
    assert.throws(()=>parseCancellationCommand(
      request,{expectedVersion:1},value),CancellationCommandRejected);
  }
});
test('request must be a canonical UUID, no fallback from body',()=>{
  for(const value of [null,{},'', '1', '../request',request+'?x=1']){
    assert.throws(()=>parseCancellationCommand(
      value,{expectedVersion:1},key),CancellationCommandRejected);
  }
});

test('unmounted cancellation command rejects exotic prototypes and accessors',()=>{
  let getterCalled=false;
  const getter=Object.defineProperty({},'expectedVersion',{
    enumerable:true,configurable:true,get(){
      getterCalled=true;
      throw new Error('untrusted getter must not run');
    },
  });
  assert.throws(()=>parseCancellationCommand(request,getter,key),
    (error:unknown)=>error instanceof CancellationCommandRejected&&
      error.reason==='invalid_request');
  assert.equal(getterCalled,false);
  const inherited=Object.create({expectedVersion:1}) as Record<string,unknown>;
  assert.throws(()=>parseCancellationCommand(request,inherited,key),
    CancellationCommandRejected);
  class Body {expectedVersion=1;}
  assert.throws(()=>parseCancellationCommand(request,new Body(),key),
    CancellationCommandRejected);
  assert.throws(()=>parseCancellationCommand(request,new Date(),key),
    CancellationCommandRejected);
  const nullProto=Object.assign(Object.create(null) as Record<string,number>,
    {expectedVersion:1});
  assert.deepEqual(parseCancellationCommand(request,nullProto,key),{
    requestId:request,expectedVersion:1,idempotencyKey:key,
  });
});

test('raw cancellation JSON allows only one bounded positive integer version',()=>{
  for(const [raw,version] of [
    ['{"expectedVersion":1}',1],
    [' \t\r\n{ "expectedVersion" : 42 }\n',42],
    ['{"expectedVersion":9007199254740991}',Number.MAX_SAFE_INTEGER],
  ] as const){
    assert.deepEqual(parseCancellationRawJsonBody(request,raw,key),{
      requestId:request,expectedVersion:version,idempotencyKey:key,
    });
  }
});
test('raw cancellation JSON denies duplicate names and escaped property aliases',()=>{
  for(const raw of [
    '{"expectedVersion":1,"expectedVersion":2}',
    '{"expectedVersion":1,"actor":"CUSTOMER"}',
    '{"expectedVersion":1,"\\u0061ctor":"SELLER"}',
    '{"expectedVersion":1,"\\u0065xpectedVersion":2}',
    '{"\\u0065xpectedVersion":1}',
    '{"expectedVersion":1,}',
    '{"expectedVersion":1}{"expectedVersion":2}',
    '{"expectedVersion":1}garbage',
    '{"expectedVersion":1}\\nnull',
    '[{"expectedVersion":1}]',
    '{"expectedVersion":true}',
    '{"expectedVersion":"1"}',
    '{"expectedVersion":1.0}',
    '{"expectedVersion":1e2}',
    '{"expectedVersion":01}',
    '{"expectedVersion":-1}',
    '{"expectedVersion":0}',
    '{"expectedVersion":9007199254740992}',
    '{"expectedVersion":999999999999999999999999999999}',
    '{"expectedVersion":1}\\u00a0',
    ' \\u00a0{"expectedVersion":1}',
    '{"expectedVersion":1}'.padEnd(129,' '),
  ]){
    assert.throws(()=>parseCancellationRawJsonBody(request,raw,key),
      CancellationCommandRejected,raw);
  }
  for(const input of [null,[],{},1,new Uint8Array([123]),undefined]){
    assert.throws(()=>parseCancellationRawJsonBody(request,input,key),
      CancellationCommandRejected);
  }
});
test('wire parser rejects invalid idempotency header and malformed request ID',()=>{
  assert.throws(()=>parseCancellationRawJsonBody(
    request,'{"expectedVersion":1}', 'bad'),CancellationCommandRejected);
  assert.throws(()=>parseCancellationRawJsonBody(
    '../invalid','{"expectedVersion":1}',key),CancellationCommandRejected);
});

test('unmounted cancellation envelope requires configured HTTPS origin',()=>{
  const valid={
    expectedOrigin:'https://services.example.test',
    origin:'https://services.example.test',
    fetchSite:'same-origin',
    contentType:'application/json; charset=utf-8',
    requestProtocol:'https:',
  };
  assert.doesNotThrow(()=>assertCancellationTransportHeaders(valid));
  assert.doesNotThrow(()=>assertCancellationTransportHeaders({
    ...valid,contentType:'application/json',
  }));
  for(const override of [
    {origin:undefined},{origin:null},{origin:['https://services.example.test']},
    {origin:'https://evil.example.test'},
    {origin:'https://services.example.test.evil.invalid'},
    {origin:'https://services.example.test:444'},
    {origin:'null'},
    {origin:'https://services.example.test/'},
    {fetchSite:undefined},{fetchSite:'none'}, {fetchSite:'same-site'},
    {fetchSite:'cross-site'}, {fetchSite:['same-origin']},
    {requestProtocol:'http:'},{requestProtocol:undefined},
    {contentType:'text/plain'},{contentType:'application/json, text/plain'},
    {contentType:'application/json; charset=iso-8859-1'},
    {contentType:'application/json; debug=true'},
    {contentType:'application/json; charset=utf-8; debug=true'},
    {contentType:['application/json']},
    {expectedOrigin:'http://services.example.test'},
    {expectedOrigin:'https://services.example.test/'},
    {expectedOrigin:'https://services.example.test/path'},
    {expectedOrigin:'https://user:pass@services.example.test'},
    {expectedOrigin:'https://services.example.test?debug=true'},
    {expectedOrigin:'https://services.example.test#fragment'},
    {expectedOrigin:'https://evil.example.test'},
    {expectedOrigin:'not-an-origin'},
  ]){
    assert.throws(()=>assertCancellationTransportHeaders({...valid,...override}),
      (error:unknown)=>error instanceof CancellationCommandRejected&&
        error.reason==='invalid_request',JSON.stringify(override));
  }
  assert.throws(()=>assertCancellationTransportHeaders(null as never),
    CancellationCommandRejected);
});

test('unmounted cancellation CSRF requires canonical session-bound 256-bit proof',()=>{
  const bound=randomBytes(32).toString('base64url');
  assert.doesNotThrow(()=>assertCancellationSessionCsrf(bound,bound));
  const another=randomBytes(32).toString('base64url');
  assert.throws(()=>assertCancellationSessionCsrf(another,bound),
    CancellationCommandRejected);
  for(const value of [
    undefined,null,'',0,{},[],['token'],false,'bad',bound+'=',
    bound+' ',bound.toUpperCase(),'a'.repeat(43),'0'.repeat(43),
    'x'.repeat(1000),
  ]){
    // Uppercase or all-zeros might accidentally form a valid canonical
    // 32-byte token, but should not match the separate trusted session key.
    if(value===bound)continue;
    assert.throws(()=>assertCancellationSessionCsrf(value,bound),
      CancellationCommandRejected);
    assert.throws(()=>assertCancellationSessionCsrf(bound,value),
      CancellationCommandRejected);
  }
  const invalidLastByte=bound.slice(0,-1)+'B';
  if(invalidLastByte!==bound){
    assert.throws(()=>assertCancellationSessionCsrf(invalidLastByte,bound),
      CancellationCommandRejected);
  }
});

test('unmounted cancellation preflight composes all security boundary checks',()=>{
  const csrf=randomBytes(32).toString('base64url');
  const valid={
    requestId:request,
    rawBody:'{"expectedVersion":3}',
    idempotencyHeader:key,
    csrfHeader:csrf,
    sessionExpectedCsrf:csrf,
    expectedOrigin:'https://services.example.test',
    origin:'https://services.example.test',
    fetchSite:'same-origin',
    contentType:'application/json',
    requestProtocol:'https:',
  };
  assert.deepEqual(parseCancellationPreflight(valid),{
    requestId:request,expectedVersion:3,idempotencyKey:key,
  });
  assert.equal(Object.isFrozen(parseCancellationPreflight(valid)),true);
  for(const changed of [
    {requestId:'../cross-request'},
    {rawBody:'{"expectedVersion":3,"expectedVersion":4}'},
    {rawBody:'{"expectedVersion":3,"actor":"SELLER"}'},
    {rawBody:'{"expectedVersion":0}'},
    {rawBody:'{"expectedVersion":1}'.padEnd(129,' ')},
    {idempotencyHeader:'invalid'},
    {idempotencyHeader:[''+key]},
    {csrfHeader:randomBytes(32).toString('base64url')},
    {csrfHeader:undefined},
    {sessionExpectedCsrf:undefined},
    {sessionExpectedCsrf:randomBytes(32).toString('base64url')},
    {expectedOrigin:'https://evil.invalid'},
    {origin:'https://evil.invalid'},
    {origin:undefined},
    {fetchSite:'cross-site'},
    {fetchSite:undefined},
    {contentType:'text/plain'},
    {contentType:'application/json; debug=true'},
    {requestProtocol:'http:'},
  ]){
    assert.throws(()=>parseCancellationPreflight({...valid,...changed}),
      CancellationCommandRejected,JSON.stringify(changed));
  }
  assert.throws(()=>parseCancellationPreflight(null as never),
    CancellationCommandRejected);
});
