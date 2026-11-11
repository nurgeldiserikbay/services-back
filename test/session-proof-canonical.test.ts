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
 for(const invalidPepper of [null,undefined,'secret',{},Buffer.alloc(16),Buffer.alloc(33)]){
  assert.throws(()=>issueSessionToken(invalidPepper as Buffer),/invalid_session_secret/);
 }
 for(const invalidToken of [null,undefined,42,{},Buffer.alloc(32)]){
  assert.throws(()=>hashSessionToken(invalidToken as string,pepper),/invalid_session_proof/);
 }
});

test('account session proof accepts every canonical final character',()=>{
 const pepper=Buffer.alloc(32,13);
 const suffixes=new Set<string>();
 for(let lastByte=0;lastByte<256;lastByte++){
  const bytes=Buffer.alloc(32);
  bytes[31]=lastByte;
  const token=bytes.toString('base64url');
  suffixes.add(token.at(-1)!);
  assert.match(hashSessionToken(token,pepper),/^[a-f0-9]{64}$/);
  assert.deepEqual(Buffer.from(token,'base64url'),bytes);
 }
 assert.deepEqual([...suffixes].sort(),[...'AEIMQUYcgkosw048'].sort());
});

test('active account session lookup uses only a derived hash and validates returned IDs',async()=>{
 const pepper=Buffer.alloc(32,21);
 const {token,hash}=issueSessionToken(pepper);
 const userId='11111111-1111-4111-8111-111111111111';
 const sessionId='22222222-2222-4222-8222-222222222222';
 let calls=0;
 const db={query:async(sql:string,params:unknown[])=>{
  calls++;
  assert.match(sql,/session\.revoked_at IS NULL/);
  assert.match(sql,/session\.expires_at>now\(\)/);
  assert.match(sql,/usr\.status='ACTIVE'/);
  assert.deepEqual(params,[hash]);
  assert.equal(sql.includes(token),false);
  return {rows:[{user_id:userId,session_id:sessionId}]};
 }};
 assert.deepEqual(await resolveActiveUserSession(db as never,token,pepper),
  {userId,sessionId});
 assert.equal(calls,1);
});

test('account session lookup fails closed on malformed database identifiers',async()=>{
 const pepper=Buffer.alloc(32,22);
 const {token}=issueSessionToken(pepper);
 for(const row of [
  undefined,
  {user_id:'not-a-uuid',session_id:'22222222-2222-4222-8222-222222222222'},
  {user_id:'11111111-1111-4111-8111-111111111111',session_id:null},
 ]){
  const db={query:async()=>({rows:row?[row]:[]})};
  assert.equal(await resolveActiveUserSession(db as never,token,pepper),null);
 }
});
