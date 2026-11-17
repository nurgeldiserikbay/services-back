import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import type {DatabasePool} from '../src/platform/database/database.pool.js';
import {GuestCancellationService} from '../src/modules/requests/guest-cancel.service.js';
import {GuestCancellationRejected} from '../src/modules/requests/guest-cancel.transaction.js';

const requestId=randomUUID();
const key='CancelGuest_2026_abcdef012345';
const proof=randomBytes(32).toString('base64url');

test('idempotent cancellation service rejects missing, malformed or shared signing keys before DB',async()=>{
  const priorPepper=process.env.GUEST_REQUEST_HMAC_KEY;
  const priorLedger=process.env.GUEST_CANCEL_LEDGER_HMAC_KEY;
  let calls=0;
  const db={transaction:async()=>{calls++;throw new Error('must_not_query_db');}} as unknown as DatabasePool;
  const service=new GuestCancellationService(db);
  const valid=randomBytes(32).toString('base64');
  try{
    for(const [pepper,ledger] of [
      [undefined,undefined],
      [valid,undefined],
      [undefined,valid],
      ['invalid',valid],
      [valid,'invalid'],
      [valid,valid],
    ] as const){
      if(pepper===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
      else process.env.GUEST_REQUEST_HMAC_KEY=pepper;
      if(ledger===undefined)delete process.env.GUEST_CANCEL_LEDGER_HMAC_KEY;
      else process.env.GUEST_CANCEL_LEDGER_HMAC_KEY=ledger;
      await assert.rejects(
        async()=>service.cancelIdempotently(requestId,proof,1,key),
        (error:unknown)=>error instanceof GuestCancellationRejected&&
          error.reason==='unavailable');
    }
    assert.equal(calls,0);
  }finally{
    if(priorPepper===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
    else process.env.GUEST_REQUEST_HMAC_KEY=priorPepper;
    if(priorLedger===undefined)delete process.env.GUEST_CANCEL_LEDGER_HMAC_KEY;
    else process.env.GUEST_CANCEL_LEDGER_HMAC_KEY=priorLedger;
  }
});

test('guest cancellation service rejects malformed command and proof before DB',async()=>{
  let calls=0;
  const db={transaction:async()=>{calls++;throw new Error('unexpected_db_access');}} as unknown as DatabasePool;
  const service=new GuestCancellationService(db);
  for(const [badRequest,badProof,badVersion,badKey] of [
    [requestId,'not-a-capability',1,key],
    [requestId,proof,0,key],
    [requestId,proof,1,'short'],
    ['bad-request-id',proof,1,key],
    [requestId,proof,Number.MAX_SAFE_INTEGER+1,key],
    [requestId,proof,1,key+',other'],
    [requestId,proof+'=',1,key],
  ] as const){
    await assert.rejects(
      async()=>service.cancelIdempotently(badRequest,badProof,badVersion,badKey),
      (error:unknown)=>error instanceof GuestCancellationRejected&&
        error.reason==='unavailable');
  }
  assert.equal(calls,0);
});

test('guest cancellation service preflight rejects untrusted transport before DB',async()=>{
  let calls=0;
  const db={transaction:async()=>{calls++;throw new Error('unexpected_database_access');}} as unknown as DatabasePool;
  const service=new GuestCancellationService(db);
  const csrf=randomBytes(32).toString('base64url');
  const valid={
    requestId,rawBody:'{"expectedVersion":1}',idempotencyHeader:key,
    csrfHeader:csrf,sessionExpectedCsrf:csrf,
    expectedOrigin:'https://services.example.test',
    origin:'https://services.example.test',
    fetchSite:'same-origin',contentType:'application/json',
    requestProtocol:'https:',
  };
  for(const changes of [
    {origin:'https://attacker.example.test'},
    {fetchSite:'cross-site'},
    {csrfHeader:randomBytes(32).toString('base64url')},
    {contentType:'text/plain'},
    {rawBody:'{"expectedVersion":1,"actor":"admin"}'},
    {idempotencyHeader:''},
  ]){
    await assert.rejects(
      async()=>service.cancelWithPreflight({...valid,...changes},proof),
    );
  }
  assert.equal(calls,0);
});

test('guest cancellation service preflight dispatches validated command to transaction',async()=>{
  const oldPepper=process.env.GUEST_REQUEST_HMAC_KEY;
  const oldLedger=process.env.GUEST_CANCEL_LEDGER_HMAC_KEY;
  const csrf=randomBytes(32).toString('base64url');
  let calls=0;
  const db={transaction:async(work:(client:{query:()=>Promise<never>})=>Promise<unknown>)=>{
    calls++;
    return work({query:async()=>{throw new Error('db_read_reached');}});
  }} as unknown as DatabasePool;
  try{
    process.env.GUEST_REQUEST_HMAC_KEY=randomBytes(32).toString('base64');
    process.env.GUEST_CANCEL_LEDGER_HMAC_KEY=randomBytes(32).toString('base64');
    const service=new GuestCancellationService(db);
    await assert.rejects(async()=>service.cancelWithPreflight({
      requestId,rawBody:'{"expectedVersion":1}',idempotencyHeader:key,
      csrfHeader:csrf,sessionExpectedCsrf:csrf,
      expectedOrigin:'https://services.example.test',
      origin:'https://services.example.test',fetchSite:'same-origin',
      contentType:'application/json',requestProtocol:'https:',
    },proof),/db_read_reached/);
    assert.equal(calls,1);
  }finally{
    if(oldPepper===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
    else process.env.GUEST_REQUEST_HMAC_KEY=oldPepper;
    if(oldLedger===undefined)delete process.env.GUEST_CANCEL_LEDGER_HMAC_KEY;
    else process.env.GUEST_CANCEL_LEDGER_HMAC_KEY=oldLedger;
  }
});

test('idempotent cancellation service uses a single transaction with distinct secrets',async()=>{
  const priorPepper=process.env.GUEST_REQUEST_HMAC_KEY;
  const priorLedger=process.env.GUEST_CANCEL_LEDGER_HMAC_KEY;
  let calls=0;
  const db={transaction:async(work:(client:{query:()=>Promise<never>})=>Promise<unknown>)=>{
    calls++;
    // Test proves delegation starts inside the transaction; no real DB
    // rows exist here, so the first SQL read intentionally rejects.
    const fake={query:async()=>{throw new Error('db_read_reached');}};
    return work(fake);
  }} as unknown as DatabasePool;
  try{
    process.env.GUEST_REQUEST_HMAC_KEY=randomBytes(32).toString('base64');
    process.env.GUEST_CANCEL_LEDGER_HMAC_KEY=randomBytes(32).toString('base64');
    const service=new GuestCancellationService(db);
    await assert.rejects(async()=>service.cancelIdempotently(requestId,proof,1,key),
      /db_read_reached/);
    assert.equal(calls,1);
  }finally{
    if(priorPepper===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
    else process.env.GUEST_REQUEST_HMAC_KEY=priorPepper;
    if(priorLedger===undefined)delete process.env.GUEST_CANCEL_LEDGER_HMAC_KEY;
    else process.env.GUEST_CANCEL_LEDGER_HMAC_KEY=priorLedger;
  }
});
