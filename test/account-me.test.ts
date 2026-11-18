import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {PoolClient} from 'pg';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {readAccountMe} from '../src/modules/identity/account-me.js';

const user='11111111-1111-4111-8111-111111111111';
const session='22222222-2222-4222-8222-222222222222';
const person='33333333-3333-4333-8333-333333333333';
const pepper=Buffer.alloc(32,7);
const {token,hash}=issueSessionToken(pepper);
function fixture(results:unknown[][]){
 const calls:{sql:string;params:unknown[]}[]=[];
 const db={query:async(sql:string,params:unknown[])=>{
  calls.push({sql,params});
  const rows=results.shift();
  assert.ok(rows,'unexpected SQL');
  return {rows};
 }} as unknown as Pick<PoolClient,'query'>;
 return {db,calls};
}
test('own account uses verified bearer identity and returns only contract fields',async()=>{
 const {db,calls}=fixture([[{user_id:user,session_id:session}],[{person_id:person,email:'private'}]]);
 assert.deepEqual(await readAccountMe(db,token,pepper),{user_id:user,person_id:person});
 assert.deepEqual(calls[0].params,[hash]);
 assert.deepEqual(calls[1].params,[user]);
 assert.match(calls[1].sql,/WHERE user_id=\$1::uuid/);
});
test('invalid bearer does not open SQL identity lookup',async()=>{
 const {db,calls}=fixture([]);
 assert.equal(await readAccountMe(db,'invalid',pepper),null);
 assert.equal(calls.length,0);
});
test('inactive session never reads person',async()=>{
 const {db,calls}=fixture([[]]);
 assert.equal(await readAccountMe(db,token,pepper),null);
 assert.equal(calls.length,1);
});
test('missing or corrupt person fails closed',async()=>{
 for(const rows of [[],[{person_id:'invalid'}],[{person_id:person},{person_id:person}]]){
  const {db}=fixture([[{user_id:user,session_id:session}],rows]);
  assert.equal(await readAccountMe(db,token,pepper),null);
 }
});
