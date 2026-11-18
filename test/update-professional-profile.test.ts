import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {BadRequestException,ConflictException,ForbiddenException} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {parseUpdateProfile,updateOwnProfessionalProfile} from '../src/modules/identity/update-professional-profile.js';
const id=randomUUID(),person=randomUUID(),profession=randomUUID(),user=randomUUID(),pepper=randomBytes(32);
const {token}=issueSessionToken(pepper);
function fixture(rows:unknown[][]){
 const calls:Array<{sql:string;params:unknown[]}>=[];const db={query:async(sql:string,params:unknown[])=>{calls.push({sql,params});const result=rows.shift();assert.ok(result);return {rows:result};}} as unknown as Pick<PoolClient,'query'>;
 return {db,calls};
}
const auth=()=>[[{user_id:user,session_id:randomUUID()}],[{person_id:person}]];
test('edit validates strong version and strictly allowed fields',()=>{
 assert.deepEqual(parseUpdateProfile(id,'"1"',{about:'Қызмет'}),{id,version:1,about:'Қызмет'});
 for(const match of ['1','W/"1"','"0"','"2147483647"',undefined])assert.throws(()=>parseUpdateProfile(id,match,{title:'x'}),BadRequestException);
 for(const body of [{},{title:null},{version:2},{title:'x'.repeat(181)},{about:'x'.repeat(3001)},{about:'\0'}])assert.throws(()=>parseUpdateProfile(id,'"1"',body),BadRequestException);
});
test('edit is owner scoped, increments version and preserves unspecified fields',async()=>{
 const row={id,profession_id:profession,lifecycle_status:'draft',slug:'draft',title:'old',about:'new',version:2};
 const f=fixture([...auth(),[{version:1}],[row],[]]);
 assert.deepEqual(await updateOwnProfessionalProfile(f.db,token,pepper,id,'"1"',{about:'new'}),{...row,offers:[]});
 assert.deepEqual(f.calls[3].params,[id,person,1,false,null,true,'new']);
 assert.match(f.calls[2].sql,/person_id=\$2::uuid FOR UPDATE/);
 assert.match(f.calls[3].sql,/version=version\+1/);
});
test('foreign and stale profile cannot mutate',async()=>{
 let f=fixture([...auth(),[]]);await assert.rejects(updateOwnProfessionalProfile(f.db,token,pepper,id,'"1"',{title:'new'}),ForbiddenException);assert.equal(f.calls.length,3);
 f=fixture([...auth(),[{version:2}]]);await assert.rejects(updateOwnProfessionalProfile(f.db,token,pepper,id,'"1"',{title:'new'}),ConflictException);assert.equal(f.calls.length,3);
});
