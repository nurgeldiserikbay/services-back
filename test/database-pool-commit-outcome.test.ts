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

test('failed BEGIN discards connection without attempting COMMIT or ROLLBACK',async()=>{
 const statements:string[]=[];
 const released:unknown[]=[];
 const db=new DatabasePool();
 (db as unknown as {pool:unknown}).pool={
  connect:async()=>({
   query:async(sql:string)=>{
    statements.push(sql);
    throw new Error('lost begin acknowledgement');
   },
   release:(error?:unknown)=>released.push(error),
  }),
  end:async()=>{},
 };
 let callbacks=0;
 await assert.rejects(db.transaction(async()=>{
  callbacks++;
  return 1;
 }),/Database operation unavailable/);
 assert.equal(callbacks,0);
 assert.deepEqual(statements,['BEGIN']);
 assert.equal(released.length,1);
 assert.ok(released[0] instanceof Error);
 assert.match((released[0] as Error).message,/begin outcome uncertain/i);
 await db.onModuleDestroy();
});

test('failed ROLLBACK discards client and reports database unavailability',async()=>{
 const statements:string[]=[];
 const released:unknown[]=[];
 const db=new DatabasePool();
 (db as unknown as {pool:unknown}).pool={
  connect:async()=>({
   query:async(sql:string)=>{
    statements.push(sql);
    if(sql==='ROLLBACK')throw new Error('rollback acknowledgement lost');
    return {rows:[]};
   },
   release:(error?:unknown)=>released.push(error),
  }),
  end:async()=>{},
 };
 let callbacks=0;
 await assert.rejects(db.transaction(async()=>{
  callbacks++;
  throw new Error('business operation failed');
 }),/Database operation unavailable/);
 assert.equal(callbacks,1);
 assert.equal(statements.filter(sql=>sql==='ROLLBACK').length,1);
 assert.equal(statements.includes('COMMIT'),false);
 assert.equal(released.length,1);
 assert.ok(released[0] instanceof Error);
 assert.match((released[0] as Error).message,/rollback failed/i);
 await db.onModuleDestroy();
});

test('successful ROLLBACK preserves original callback failure and reuses client',async()=>{
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
 await assert.rejects(db.transaction(async()=>{
  throw new Error('business operation failed');
 }),/business operation failed/);
 assert.equal(statements.at(-1),'ROLLBACK');
 assert.equal(statements.includes('COMMIT'),false);
 assert.deepEqual(released,[undefined]);
 await db.onModuleDestroy();
});

test('transaction setup failure rolls back before work and never commits',async()=>{
 const statements:string[]=[];
 const released:unknown[]=[];
 const db=new DatabasePool();
 (db as unknown as {pool:unknown}).pool={
  connect:async()=>({
   query:async(sql:string)=>{
    statements.push(sql);
    if(sql.includes('statement_timeout'))throw new Error('timeout setup failed');
    return {rows:[]};
   },
   release:(error?:unknown)=>released.push(error),
  }),
  end:async()=>{},
 };
 let callbacks=0;
 await assert.rejects(db.transaction(async()=>{callbacks++;return 1;}),/timeout setup failed/);
 assert.equal(callbacks,0);
 assert.deepEqual(statements,[
  'BEGIN',"SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '8s'",'ROLLBACK',
 ]);
 assert.deepEqual(released,[undefined]);
 await db.onModuleDestroy();
});

test('connection acquisition failure is mapped to unavailable without running work',async()=>{
 const db=new DatabasePool();
 (db as unknown as {pool:unknown}).pool={
  connect:async()=>{throw new Error('database connection refused');},
  end:async()=>{},
 };
 let callbacks=0;
 await assert.rejects(db.transaction(async()=>{callbacks++;return 1;}),/Database operation unavailable/);
 assert.equal(callbacks,0);
 await db.onModuleDestroy();
});

test('throwing release after uncertain COMMIT is never invoked twice',async()=>{
 const statements:string[]=[];
 let releases=0;
 const db=new DatabasePool();
 (db as unknown as {pool:unknown}).pool={
  connect:async()=>({
   query:async(sql:string)=>{
    statements.push(sql);
    if(sql==='COMMIT')throw new Error('commit acknowledgement lost');
    return {rows:[]};
   },
   release:()=>{
    releases++;
    throw new Error('release failed');
   },
  }),
  end:async()=>{},
 };
 await assert.rejects(db.transaction(async()=>42),/Database operation unavailable/);
 assert.equal(releases,1);
 assert.equal(statements.filter(sql=>sql==='COMMIT').length,1);
 assert.equal(statements.includes('ROLLBACK'),false);
 await db.onModuleDestroy();
});

test('throwing release after uncertain BEGIN is never invoked twice',async()=>{
 let releases=0;
 const db=new DatabasePool();
 (db as unknown as {pool:unknown}).pool={
  connect:async()=>({
   query:async()=>{throw new Error('begin acknowledgement lost');},
   release:()=>{
    releases++;
    throw new Error('release failed');
   },
  }),
  end:async()=>{},
 };
 await assert.rejects(db.transaction(async()=>42),/Database operation unavailable/);
 assert.equal(releases,1);
 await db.onModuleDestroy();
});
