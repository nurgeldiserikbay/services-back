import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabasePool} from '../src/platform/database/database.pool.js';

test('failed COMMIT discards connection and does not retry or issue ROLLBACK',async()=>{
 const statements:string[]=[];
 const released:unknown[]=[];
 let connects=0;
 const client={
  query:async(sql:string)=>{
   statements.push(sql);
   if(sql==='COMMIT')throw new Error('lost commit acknowledgement');
   return {rows:[]};
  },
  release:(error?:unknown)=>released.push(error),
 };
 const db=new DatabasePool();
 (db as unknown as {pool:unknown}).pool={
  connect:async()=>{connects++;return client;},
  end:async()=>{},
 };
 let callbacks=0;
 await assert.rejects(db.transaction(async()=>{
  callbacks++;
  return 'never acknowledge';
 }),/Database operation unavailable/);
 assert.equal(callbacks,1);
 assert.equal(connects,1);
 assert.equal(statements.filter(sql=>sql==='COMMIT').length,1);
 assert.equal(statements.includes('ROLLBACK'),false);
 assert.equal(released.length,1);
 assert.ok(released[0] instanceof Error);
 assert.match((released[0] as Error).message,/commit outcome uncertain/i);
 await db.onModuleDestroy();
});

test('successful COMMIT returns result and releases a reusable connection',async()=>{
 const statements:string[]=[];
 const released:unknown[]=[];
 const db=new DatabasePool();
 (db as unknown as {pool:unknown}).pool={
  connect:async()=>({
   query:async(sql:string)=>{statements.push(sql);return {rows:[]};},
   release:(error?:unknown)=>released.push(error),
  }),
  end:async()=>{},
 };
 assert.equal(await db.transaction(async()=>42),42);
 assert.equal(statements.at(-1),'COMMIT');
 assert.deepEqual(released,[undefined]);
 await db.onModuleDestroy();
});
