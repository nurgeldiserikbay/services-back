import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {
 issueAdminSessionToken,hashAdminSessionToken,adminSessionHashMatches,
} from '../src/modules/admin/admin-session-token.js';
import {hashSessionToken,issueSessionToken}
 from '../src/modules/identity/session-proof.js';

test('admin tokens have separate hash domain from regular account sessions',()=>{
 const pepper=randomBytes(32);
 const {token,tokenHash}=issueAdminSessionToken(pepper);
 assert.match(token,/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
 assert.match(tokenHash,/^[a-f0-9]{64}$/);
 assert.notEqual(tokenHash,hashSessionToken(token,pepper));
 assert.equal(adminSessionHashMatches(token,tokenHash,pepper),true);
 assert.equal(adminSessionHashMatches(issueSessionToken(pepper).token,tokenHash,pepper),false);
 assert.equal(adminSessionHashMatches(token,tokenHash,randomBytes(32)),false);
});
test('admin token hashing rejects missing, invalid or weak secrets',()=>{
 const pepper=randomBytes(32);
 const token=issueAdminSessionToken(pepper).token;
 for(const weak of [Buffer.alloc(0),Buffer.alloc(16)]){
  assert.throws(()=>issueAdminSessionToken(weak));
  assert.throws(()=>hashAdminSessionToken(token,weak));
 }
 for(const invalid of [null,undefined,'bad',token+'=',42]){
  assert.throws(()=>hashAdminSessionToken(invalid,pepper));
  assert.equal(adminSessionHashMatches(invalid,'a'.repeat(64),pepper),false);
 }
 assert.equal(adminSessionHashMatches(token,'INVALID',pepper),false);
});

test('admin bearer rejects noncanonical base64url aliases',()=>{
 const pepper=randomBytes(32);
 const {token,tokenHash}=issueAdminSessionToken(pepper);
 // Base64url encodes 32 bytes with two padding bits in its last digit.
 // Other last characters may decode to identical bytes in permissive decoders.
 const canonicalSuffixes='AEIMQUYcgkosw048';
 for(const suffix of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'){
  const candidate=token.slice(0,-1)+suffix;
  if(canonicalSuffixes.includes(suffix)){
   assert.doesNotThrow(()=>hashAdminSessionToken(candidate,pepper));
   continue;
  }
  assert.throws(()=>hashAdminSessionToken(candidate,pepper));
  assert.equal(adminSessionHashMatches(candidate,tokenHash,pepper),false);
 }
 assert.equal(adminSessionHashMatches(token,tokenHash,pepper),true);
});

test('issued admin tokens round-trip across every canonical final character',()=>{
 const pepper=Buffer.alloc(32,11);
 const suffixes=new Set<string>();
 for(let lastByte=0;lastByte<256;lastByte++){
  const bytes=Buffer.alloc(32);
  bytes[31]=lastByte;
  const token=bytes.toString('base64url');
  suffixes.add(token.at(-1)!);
  const hash=hashAdminSessionToken(token,pepper);
  assert.equal(adminSessionHashMatches(token,hash,pepper),true);
  assert.deepEqual(Buffer.from(token,'base64url'),bytes);
 }
 assert.deepEqual([...suffixes].sort(),[...'AEIMQUYcgkosw048'].sort());
});

test('admin session proof fails closed on token tampering and hash formatting',()=>{
 const pepper=Buffer.alloc(32,17);
 const {token,tokenHash}=issueAdminSessionToken(pepper);
 const alternatives='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
 for(const position of [0,10,21,41]){
  const replacement=[...alternatives].find(char=>char!==token[position])!;
  const tampered=token.slice(0,position)+replacement+token.slice(position+1);
  assert.equal(adminSessionHashMatches(tampered,tokenHash,pepper),false);
 }
 for(const invalidHash of [
  tokenHash.toUpperCase(),' '+tokenHash,tokenHash+' ',tokenHash.slice(1),
  tokenHash+'0',null,undefined,
 ]){
  assert.equal(adminSessionHashMatches(token,invalidHash,pepper),false);
 }
 assert.equal(adminSessionHashMatches(token,tokenHash,pepper),true);
});
