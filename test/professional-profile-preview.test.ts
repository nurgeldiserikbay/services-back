import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {BadRequestException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {readProfilePreview} from '../src/modules/identity/professional-profile-preview.js';
const pepper=randomBytes(32),{token}=issueSessionToken(pepper);
const user=randomUUID(),person=randomUUID(),id=randomUUID(),profession=randomUUID();
function fixture(results:unknown[][]){
 const calls:Array<{sql:string;params:unknown[]}>=[];const db={query:async(sql:string,params:unknown[])=>{
  calls.push({sql,params});const rows=results.shift();assert.ok(rows);return {rows};
 }} as unknown as Pick<PoolClient,'query'>;
 return {db,calls};
}
const actor=()=>[[{user_id:user,session_id:randomUUID()}],[{person_id:person}]];
test('preview returns only owner draft and published projection',async()=>{
 const row={id,slug:'specialist',profession_id:profession,lifecycle_status:'published',
  title:'private draft',about:'new private',version:2,
  published_title:'visible title',published_about:null,published_version:1,secret:'not returned'};
 const f=fixture([...actor(),[row]]);
 assert.deepEqual(await readProfilePreview(f.db,token,pepper,id),{
  id,slug:'specialist',profession_id:profession,lifecycle_status:'published',
  draft:{title:'private draft',about:'new private',version:2},
  published:{title:'visible title',about:null,version:1},
 });
 assert.deepEqual(f.calls[2].params,[id,person]);
 assert.match(f.calls[2].sql,/person_id=\$2::uuid/);
});
test('preview hides absent or foreign IDs and permits an unpublished draft',async()=>{
 const f=fixture([...actor(),[]]);
 await assert.rejects(readProfilePreview(f.db,token,pepper,id),NotFoundException);
 assert.equal(f.calls.length,3);
 const draft={id,slug:'draft',profession_id:profession,lifecycle_status:'draft',
  title:null,about:null,version:1,published_title:null,published_about:null,published_version:null};
 const g=fixture([...actor(),[draft]]);
 assert.equal((await readProfilePreview(g.db,token,pepper,id)).published,null);
});
test('malformed ID and untrusted bearer never reach profile SQL',async()=>{
 let f=fixture([]);await assert.rejects(readProfilePreview(f.db,token,pepper,'bad'),BadRequestException);assert.equal(f.calls.length,0);
 f=fixture([]);await assert.rejects(readProfilePreview(f.db,'invalid',pepper,id),UnauthorizedException);assert.equal(f.calls.length,0);
});
