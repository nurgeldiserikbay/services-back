import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  decideSellerRequest,SellerDecisionRejected,
} from '../src/modules/requests/seller-decision.transaction.js';

test('seller decisions reject malformed identities and versions without SQL',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;throw new Error('unexpected SQL');}};
 const requestId=randomUUID(),sellerId=randomUUID();
 const seller={kind:'professional',sellerId} as const;
 const cases: Array<[unknown,unknown,unknown,unknown]>=[
  [null,seller,'accept',1],
  [requestId,null,'accept',1],
  [requestId,undefined,'accept',1],
  [requestId,{kind:'professional'},'accept',1],
  [requestId,{kind:'professional',sellerId:null},'accept',1],
  [requestId,{kind:'organization',sellerId:'bad'},'accept',1],
  [requestId,{kind:'auditor',sellerId},'accept',1],
  [requestId,seller,'approve',1],
  [requestId,seller,'accept',0],
  [requestId,seller,'accept',1.5],
  [requestId,seller,'accept',Number.MAX_SAFE_INTEGER+1],
 ];
 for(const [id,actor,decision,version] of cases){
  await assert.rejects(
   decideSellerRequest(db as never,id as string,actor as never,
    decision as never,version as number),
   (error:unknown)=>error instanceof SellerDecisionRejected&&error.reason==='not_found',
  );
 }
 assert.equal(calls,0);
});
