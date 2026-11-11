import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashSessionToken,issueSessionToken,resolveActiveUserSession}
 from '../src/modules/identity/session-proof.js';

test('issued account session proofs use canonical 32-byte base64url encoding',()=>{
 const pepper=Buffer.alloc(32,5);
 for(let index=0;index<64;index++){
  const {token,hash}=issueSessionToken(pepper);
  assert.match(token,/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
  assert.equal(hashSessionToken(token,pepper),hash);
 }
});

test('account session hashing rejects noncanonical base64url aliases',()=>{
 const pepper=Buffer.alloc(32,9);
 const {token}=issueSessionToken(pepper);
 const suffixes='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
 for(const suffix of suffixes){
  const candidate=token.slice(0,-1)+suffix;
  if('AEIMQUYcgkosw048'.includes(suffix)){
   assert.doesNotThrow(()=>hashSessionToken(candidate,pepper));
  }else{
   assert.throws(()=>hashSessionToken(candidate,pepper),/invalid_session_proof/);
  }
 }
});

test('noncanonical account bearer is rejected without querying the database',async()=>{
 const pepper=Buffer.alloc(32,7);
 const {token}=issueSessionToken(pepper);
 const alias=token.slice(0,-1)+'B';
 let queried=false;
 const db={query:async()=>{queried=true;throw new Error('must not query');}};
 assert.equal(await resolveActiveUserSession(db as never,alias,pepper),null);
 assert.equal(queried,false);
});

test('account session proof rejects invalid runtime secret types before database access',async()=>{
 const pepper=Buffer.alloc(32,7);
 const {token}=issueSessionToken(pepper);
 for(const invalidPepper of [null,undefined,'secret',{},Buffer.alloc(16),Buffer.alloc(33)]){
  assert.throws(()=>hashSessionToken(token,invalidPepper as Buffer),/invalid_session_proof/);
  let queried=false;
  const db={query:async()=>{queried=true;throw new Error('unexpected query');}};
  await assert.rejects(
   resolveActiveUserSession(db as never,token,invalidPepper as Buffer),
   /invalid_session_secret/,
  );
  assert.equal(queried,false);
 }
 for(const invalidToken of [null,undefined,42,{},Buffer.alloc(32)]){
  assert.throws(()=>hashSessionToken(invalidToken as string,pepper),/invalid_session_proof/);
 }
});
