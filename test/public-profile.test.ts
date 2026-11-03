import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicProfileRepository} from '../src/modules/catalog/public-profile.repository.js';
import type {DatabasePool} from '../src/platform/database/database.pool.js';

test('private/draft profile is never returned, with no fallback',async()=>{
  const db={query:async()=>({rows:[]})} as unknown as DatabasePool;
  await assert.rejects(()=>new PublicProfileRepository(db).professional('hidden'),/Public profile not found/);
  await assert.rejects(()=>new PublicProfileRepository(db).organization('00000000-0000-4000-8000-000000000001'),/Public organization not found/);
});
test('public profile projection exposes only explicitly selected fields',async()=>{
  const recorded:string[]=[];
  const db={query:async(sql:string)=>{
    recorded.push(sql);
    if(sql.includes('FROM professional_profiles'))return {rows:[{id:'00000000-0000-4000-8000-000000000001',profession_id:'00000000-0000-4000-8000-000000000002',slug:'electrician',title:'Electrician',secret_token:'NEVER'}]};
    return {rows:[{id:'00000000-0000-4000-8000-000000000003',title:'Repair',delivery_mode:'online',price_label:null,secret_token:'NEVER'}]};
  }} as unknown as DatabasePool;
  const result=await new PublicProfileRepository(db).professional('electrician');
  assert.equal('secret_token' in result,false);
  assert.equal('secret_token' in result.offers[0],false);
  assert.ok(recorded.every(sql=>!sql.includes('guest_contacts')&&!sql.includes('users')));
});
