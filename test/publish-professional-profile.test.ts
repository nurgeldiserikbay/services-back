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
 const f=fixture([...auth(),[ready],[{present:true}],[{blocked:false}],[{blocked:false}],[{blocked:false}],[{id,version:3,published_version:3}],[]]);
 assert.deepEqual(await publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),{id,lifecycle_status:'published',version:3,published_version:3});
 assert.match(f.calls[2].sql,/person_id=\$2::uuid FOR UPDATE/);
 assert.match(f.calls[4].sql,/platform_moderation_cases/);
 assert.match(f.calls[5].sql,/service_requests/);
 assert.match(f.calls[6].sql,/service_assignments/);
 assert.match(f.calls[7].sql,/published_title=title/);
 assert.match(f.calls[8].sql,/professional_publication_audit/);
 assert.deepEqual(f.calls[8].params,[id,person,'DRAFT',2,3]);
});
test('stale, foreign, incomplete and no-offer profiles cannot publish',async()=>{
 let f=fixture([...auth(),[]]);await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),NotFoundException);
 f=fixture([...auth(),[{...ready,version:3}]]);await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),ConflictException);
 f=fixture([...auth(),[{...ready,title:'  '}]]);await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),ConflictException);
 f=fixture([...auth(),[ready],[{present:false}]]);await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),ConflictException);
 assert.equal(f.calls.length,4);
});
test('unresolved moderation and active requests fail closed without a write',async()=>{
 let f=fixture([...auth(),[ready],[{present:true}],[{blocked:true}]]);
 await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),ConflictException);
 assert.equal(f.calls.length,5);
 assert.deepEqual(f.calls[4].params,['professional:'+id]);
 f=fixture([...auth(),[ready],[{present:true}],[{blocked:false}],[{blocked:true}]]);
 await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),ConflictException);
 assert.equal(f.calls.length,6);
 assert.deepEqual(f.calls[5].params,[id]);
 for(const broken of [[],[{blocked:null}]]) {
  f=fixture([...auth(),[ready],[{present:true}],broken]);
  await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),ConflictException);
  assert.equal(f.calls.length,5);
 }
});
test('proposed and accepted service assignments block publishing with no snapshot write',async()=>{
 for(const row of [{blocked:true},{blocked:null}]){
  const f=fixture([...auth(),[ready],[{present:true}],[{blocked:false}],[{blocked:false}],[row]]);
  await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,id,'"2"',{}),ConflictException);
  assert.equal(f.calls.length,7);
  assert.match(f.calls[6].sql,/service_assignments/);
  assert.deepEqual(f.calls[6].params,[id]);
  assert.equal(f.calls.some(x=>x.sql.includes('UPDATE professional_profiles')),false);
  assert.equal(f.calls.some(x=>x.sql.includes('professional_publication_audit')),false);
 }
});
test('invalid token and malformed path do not touch profile SQL',async()=>{
 let f=fixture([]);await assert.rejects(publishOwnProfessionalProfile(f.db,token,pepper,'bad','"2"',{}),BadRequestException);assert.equal(f.calls.length,0);
 f=fixture([]);await assert.rejects(publishOwnProfessionalProfile(f.db,'invalid',pepper,id,'"2"',{}),UnauthorizedException);assert.equal(f.calls.length,0);
});
