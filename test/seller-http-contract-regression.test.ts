import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BadRequestException,UnauthorizedException} from '@nestjs/common';
import {validateSellerDecisionHttp} from '../src/modules/requests/seller-decision-http.contract.js';
import {parseSellerInboxFilter,requireBearerSession,encodeInboxCursor} from '../src/modules/requests/seller-inbox.contract.js';

const requestId='11111111-1111-4111-8111-111111111111';
const authorization='Bearer '+'a'.repeat(43);
const valid={authorization,requestId,version:'"2"',idempotencyKey:'seller_'+'b'.repeat(32)};

test('seller decision requires bearer, strong version and idempotency',()=>{
  assert.deepEqual(validateSellerDecisionHttp(valid),{
    token:'a'.repeat(43),requestId,expectedVersion:2,key:valid.idempotencyKey,
  });
  for(const version of [undefined,'2','W/"2"','"0"','*','"10000000000"']){
    assert.throws(()=>validateSellerDecisionHttp({...valid,version}),BadRequestException);
  }
  assert.throws(()=>validateSellerDecisionHttp({...valid,authorization:'Bearer invalid'}),UnauthorizedException);
  assert.throws(()=>validateSellerDecisionHttp({...valid,idempotencyKey:'short'}),BadRequestException);
});

test('seller inbox requires explicit bearer and bounded page size',()=>{
  assert.equal(requireBearerSession(authorization),'a'.repeat(43));
  assert.throws(()=>requireBearerSession(undefined),UnauthorizedException);
  assert.equal(parseSellerInboxFilter({}).limit,20);
  assert.equal(parseSellerInboxFilter({limit:'50',state:'pending'}).state,'pending');
  for(const limit of ['0','51','-1','100','01']){
    assert.throws(()=>parseSellerInboxFilter({limit}),BadRequestException);
  }
});

test('seller inbox cursor roundtrips and rejects malformed input',()=>{
  const createdAt='2026-11-07T10:00:00.000Z';
  const cursor=encodeInboxCursor(createdAt,requestId);
  assert.deepEqual(parseSellerInboxFilter({cursor}).before,{createdAt,id:requestId});
  for(const bad of ['%', 'not-a-cursor', 'a'.repeat(257)]){
    assert.throws(()=>parseSellerInboxFilter({cursor:bad}),BadRequestException);
  }
});
