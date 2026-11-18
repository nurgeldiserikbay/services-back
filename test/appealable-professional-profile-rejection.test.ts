import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {BadRequestException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {findOwnAppealableProfileRejection} from '../src/modules/identity/appealable-professional-profile-rejection.js';
const id=randomUUID(),person=randomUUID(),user=randomUUID(),decision=randomUUID();
const pepper=randomBytes(32),{token}=issueSessionToken(pepper);
const auth=()=>[[{user_id:user,session_id:randomUUID()}],[{person_id:person}]];
function fixture(rows:unknown[][]){
 const sql:string[]=[];
 const db={query:async(text:string)=>{sql.push(text);const result=rows.shift();assert.ok(result);return {rows:result};}} as unknown as Pick<PoolClient,'query'>;
 return {db,sql};
}
test('lookup is owner-scoped and returns minimal rejected decision proof',async()=>{
 const f=fixture([...auth(),[{version:2}],[{decision_id:decision}]]);
 assert.deepEqual(await findOwnAppealableProfileRejection(f.db,token,pepper,id),
  {profile_id:id,profile_version:2,decision_id:decision});
 assert.match(f.sql[2],/person_id=\$2::uuid FOR SHARE/);
 assert.match(f.sql[3],/professional_moderation_appeals/);
 assert.match(f.sql[3],/decision='REJECT'/);
 assert.match(f.sql[3],/open_case.state<>'closed'/);
});
test('missing, foreign and no-eligible records fail closed without disclosure',async()=>{
 let f=fixture([...auth(),[]]);
 await assert.rejects(findOwnAppealableProfileRejection(f.db,token,pepper,id),NotFoundException);
 assert.equal(f.sql.length,3);
 f=fixture([...auth(),[{version:2}],[]]);
 assert.equal(await findOwnAppealableProfileRejection(f.db,token,pepper,id),null);
 f=fixture([...auth(),[{version:2}],[{decision_id:'not-a-uuid'}]]);
 await assert.rejects(findOwnAppealableProfileRejection(f.db,token,pepper,id),NotFoundException);
});
test('malformed ID and invalid session cannot discover decisions',async()=>{
 let f=fixture([]);
 await assert.rejects(findOwnAppealableProfileRejection(f.db,token,pepper,'invalid'),BadRequestException);
 assert.equal(f.sql.length,0);
 f=fixture([]);
 await assert.rejects(findOwnAppealableProfileRejection(f.db,'bad',pepper,id),UnauthorizedException);
 assert.equal(f.sql.length,0);
});
