import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {BadRequestException,UnauthorizedException} from '@nestjs/common';
import {validateSellerDecisionHttp} from '../src/modules/requests/seller-decision-http.contract.js';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';

test('native/server mutation validates strong If-Match and mandatory idempotency',()=>{
 const token=issueSessionToken(randomBytes(32)).token;
 const id=randomUUID(),key='test_key_123456789';
 assert.deepEqual(validateSellerDecisionHttp({
  authorization:'Bearer '+token,requestId:id,version:'"3"',idempotencyKey:key,
 }),{token,requestId:id,expectedVersion:3,key});
 for(const version of [undefined,'3','W/"3"','*','"0"','"-1"','"9999999999999999999999"']){
  assert.throws(()=>validateSellerDecisionHttp({
   authorization:'Bearer '+token,requestId:id,version,idempotencyKey:key,
  }),BadRequestException);
 }
 for(const authorization of [undefined,'','Bearer short','Basic '+token]){
  assert.throws(()=>validateSellerDecisionHttp({
   authorization,requestId:id,version:'"1"',idempotencyKey:key,
  }),UnauthorizedException);
 }
 assert.throws(()=>validateSellerDecisionHttp({
  authorization:'Bearer '+token,requestId:id,version:'"1"',idempotencyKey:'short',
 }),BadRequestException);
});

test('seller decision rejects malformed request IDs before processing a mutation',()=>{
 const token=issueSessionToken(randomBytes(32)).token;
 for(const requestId of [undefined,null,'','not-a-uuid','00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-0000-000000000000','00000000-0000-4000-8000-00000000000z']){
  assert.throws(()=>validateSellerDecisionHttp({authorization:'Bearer '+token,
   requestId,version:'"1"',idempotencyKey:'valid-idempotency-key-123'}),BadRequestException);
 }
});

test('seller decision requires canonical quoted versions without leading zeros',()=>{
 const token=issueSessionToken(randomBytes(32)).token;
 for(const version of ['"01"','"0001"','"1.0"','"+1"','" 1"','"1 "','"21474836480"','"42949672960"']){
  assert.throws(()=>validateSellerDecisionHttp({authorization:'Bearer '+token,
   requestId:randomUUID(),version,idempotencyKey:'valid-idempotency-key-123'}),BadRequestException);
 }
});
