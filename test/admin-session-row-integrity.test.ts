import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {PoolClient} from 'pg';
import {resolvePlatformAdminSession} from '../src/modules/admin/admin-session-resolver.js';

const now=Date.parse('2026-11-08T00:00:00.000Z');
const userId='123e4567-e89b-42d3-a456-426614174000';
const valid=()=>({
 user_id:userId,role:'operator',
 expires_at:new Date(now+60_000),
 mfa_verified_at:new Date(now-60_000),
 scope:'platform:123e4567-e89b-42d3-a456-426614174001',
});
const pepper=Buffer.alloc(32,7);
const bearer='A'.repeat(43);
function client(rows:unknown[]){
 return {query:async()=>({rows})} as unknown as Pick<PoolClient,'query'>;
}

test('admin resolver rejects noncanonical 43-character bearer before querying',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;return {rows:[valid()]};}} as unknown as Pick<PoolClient,'query'>;
 assert.equal(await resolvePlatformAdminSession(db,'A'.repeat(42)+'B',pepper,now),null);
 assert.equal(queries,0);
});

test('admin resolver accepts a consistent authorized row',async()=>{
 const result=await resolvePlatformAdminSession(client([valid()]),bearer,pepper,now);
 assert.equal(result?.userId,userId);
 assert.deepEqual(result?.resourceScopes,['platform:123e4567-e89b-42d3-a456-426614174001']);
});

test('admin resolver fails closed for malformed joined grant rows',async()=>{
 for(const row of [
  {...valid(),expires_at:null},
  {...valid(),mfa_verified_at:'invalid'},
  {...valid(),scope:''},
  {...valid(),scope:'platform:moderation'},
  {...valid(),scope:'platform:123e4567-e89b-42d3-a456-426614174001 '},
  {...valid(),scope:42},
  null,
 ]){
  const rows=row===null?[valid(),null]:[valid(),row];
  assert.equal(await resolvePlatformAdminSession(client(rows),bearer,pepper,now),null);
 }
});

test('admin resolver rejects duplicate grants and inconsistent role or expiry',async()=>{
 for(const row of [
  valid(),
  {...valid(),role:'admin'},
  {...valid(),expires_at:new Date(now+120_000)},
 ]){
  assert.equal(await resolvePlatformAdminSession(client([valid(),row]),bearer,pepper,now),null);
 }
});
