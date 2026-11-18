import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import type {PoolClient} from 'pg';
import {BadRequestException,ConflictException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {parsePublishRequest,publishOwnProfessionalProfile} from '../src/modules/identity/publish-professional-profile.js';
const id=randomUUID(),person=randomUUID(),user=randomUUID(),pepper=randomBytes(32),{token}=issueSessionToken(pepper);
const auth=()=>[[{user_id:user,session_id:randomUUID()}],[{person_id:person}]];
function fixture(results:unknown[][]){
 const calls:Array<{sql:string;params:unknown[]}>=[];const db={query:async(sql:string,params:unknown[])=>{
  calls.push({sql,params});const rows=results.shift();assert.ok(rows);return {rows};
 }} as unknown as Pick<PoolClient,'query'>;
 return {db,calls};
}
const ready={id,version:2,title:'Electrician',about:'Experienced licensed specialist in repairs',status:'DRAFT',published_version:null};
test('publish body and version are strict',()=>{
 assert.deepEqual(parsePublishRequest(id,'"2"',{}),{id,version:2});
 for(const b of [{version:2},{action:'publish'},[],null])assert.throws(()=>parsePublishRequest(id,'"2"',b),BadRequestException);
 for(const m of ['2','W/"2"','"0"','"2147483646"'])assert.throws(()=>parsePublishRequest(id,m,{}),BadRequestException);
});
test('publish locks owner row, enforces offer and writes audit after snapshot',async()=>{
 const f=fixture([...auth(),[ready],[{present:true}],[{id,version:3,published_version:3}],[]]);
 assert.deepEqual(await publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),{id,lifecycle_status:'published',version:3,published_version:3});
 assert.match(f.calls[2].sql,/person_id=\$2::uuid FOR UPDATE/);
 assert.match(f.calls[4].sql,/published_title=title/);
 assert.match(f.calls[5].sql,/professional_publication_audit/);
 assert.deepEqual(f.calls[5].params,[id,person,'DRAFT',2,3]);
});
test('stale, foreign, incomplete and no-offer profiles cannot publish',async()=>{
 let f=fixture([...auth(),[]]);await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),NotFoundException);
 f=fixture([...auth(),[{...ready,version:3}]]);await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),ConflictException);
 f=fixture([...auth(),[{...ready,title:'  '}]]);await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),ConflictException);
 f=fixture([...auth(),[ready],[{present:false}]]);await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),ConflictException);
 assert.equal(f.calls.length,4);
});
test('invalid token and malformed path do not touch profile SQL',async()=>{
 let f=fixture([]);await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,'bad','"2"',{}),BadRequestException);assert.equal(f.calls.length,0);
 f=fixture([]);await assert.rejects(publishOwnProfessionalProfile(f.db,'invalid',pepper,id,'"2"',{}),UnauthorizedException);assert.equal(f.calls.length,0);
});
