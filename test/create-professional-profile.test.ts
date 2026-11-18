import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {BadRequestException,UnauthorizedException,ConflictException} from '@nestjs/common';
import {parseCreateProfile,createOwnProfessionalProfile} from '../src/modules/identity/create-professional-profile.js';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import type {PoolClient} from 'pg';
const profession=randomUUID(),person=randomUUID(),user=randomUUID(),id=randomUUID();
const pepper=randomBytes(32),{token}=issueSessionToken(pepper);
const body={profession_id:profession,preferred_slug:'my-profile'},key='test-key-1234';
function fixture(rows:unknown[][]){
 const calls:Array<{sql:string;params:unknown[]}>=[];const db={query:async(sql:string,params:unknown[])=>{calls.push({sql,params});const next=rows.shift();assert.ok(next);return {rows:next};}} as unknown as Pick<PoolClient,'query'>;
 return {db,calls};
}
test('profile creation validates strict body, canonical profession and idempotency key',()=>{
 assert.deepEqual(parseCreateProfile(body,key),{professionId:profession,preferredSlug:'my-profile',key});
 for(const invalid of [{...body,person_id:person},{...body,preferred_slug:'Bad Slug'},{profession_id:'bad'},null,[]])
  assert.throws(()=>parseCreateProfile(invalid,key),BadRequestException);
 assert.throws(()=>parseCreateProfile(body,'short'),BadRequestException);
});
test('profile creation derives owner from live session and records draft atomically',async()=>{
 const row={id,profession_id:profession,lifecycle_status:'draft',slug:'my-profile',title:null};
 const f=fixture([[{user_id:user,session_id:randomUUID()}],[{person_id:person}],[{id:randomUUID()}],[row],[{id:randomUUID()}]]);
 assert.deepEqual(await createOwnProfessionalProfile(f.db,token,pepper,body,key),{...row,offers:[]});
 assert.equal(f.calls[3].params[1],person);
 assert.equal(f.calls[3].params[2],profession);
 assert.match(f.calls[2].sql,/ON CONFLICT/);
 assert.match(f.calls[3].sql,/ON CONFLICT DO NOTHING/);
 assert.match(f.calls[4].sql,/COMPLETED/);
 assert.notEqual(f.calls[2].params[3],key);
});
test('invalid bearer and duplicate profile fail closed',async()=>{
 let f=fixture([]);await assert.rejects(createOwnProfessionalProfile(f.db,'bad',pepper,body,key),UnauthorizedException);assert.equal(f.calls.length,0);
 f=fixture([[{user_id:user,session_id:randomUUID()}],[{person_id:person}],[{id:randomUUID()}],[]]);
 await assert.rejects(createOwnProfessionalProfile(f.db,token,pepper,body,key),ConflictException);assert.equal(f.calls.length,4);
});
