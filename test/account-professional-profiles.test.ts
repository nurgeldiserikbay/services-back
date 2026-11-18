import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {listOwnProfessionalProfiles} from '../src/modules/identity/account-professional-profiles.js';
const pepper=randomBytes(32),user=randomUUID(),person=randomUUID(),profile=randomUUID(),profession=randomUUID(),offer=randomUUID();
const {token}=issueSessionToken(pepper);
function fixture(results:unknown[][]){
 const calls:Array<{sql:string;params:unknown[]}>=[];
 const db={query:async(sql:string,params:unknown[])=>{
  calls.push({sql,params}); const rows=results.shift();assert.ok(rows);return {rows};
 }} as unknown as Pick<PoolClient,'query'>;
 return {db,calls};
}
test('owner profile inventory includes draft state and allowlisted published offers only',async()=>{
 const {db,calls}=fixture([[{user_id:user,session_id:randomUUID()}],[{person_id:person}],
 [{id:profile,profession_id:profession,lifecycle_status:'draft',slug:'draft',title:null,private_value:'secret'}],
 [{id:offer,professional_id:profile,title:'Offer',delivery_mode:'online',price_label:null,contacts:'secret'}]]);
 assert.deepEqual(await listOwnProfessionalProfiles(db,token,pepper),[{id:profile,profession_id:profession,lifecycle_status:'draft',slug:'draft',title:null,offers:[{id:offer,title:'Offer',delivery_mode:'online',price_label:null}]}]);
 assert.deepEqual(calls[2].params,[person]);assert.deepEqual(calls[3].params,[person,[profile]]);
 assert.match(calls[2].sql,/WHERE person_id=\$1::uuid/);
 assert.match(calls[3].sql,/p.person_id=\$1::uuid AND o.status='PUBLISHED'/);
});
test('invalid bearer never reaches profile SQL; no profiles requires no offer query',async()=>{
 let f=fixture([]);assert.equal(await listOwnProfessionalProfiles(f.db,'invalid',pepper),null);assert.equal(f.calls.length,0);
 f=fixture([[{user_id:user,session_id:randomUUID()}],[{person_id:person}],[]]);
 assert.deepEqual(await listOwnProfessionalProfiles(f.db,token,pepper),[]);assert.equal(f.calls.length,3);
});
