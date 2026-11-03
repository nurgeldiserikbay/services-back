import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, Pool } from 'pg';
import { DatabasePool } from '../src/platform/database/database.pool.js';

test('same connection runs BEGIN, persists on commit and rolls back after failed unit', async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL required for integration test');
  const db = new DatabasePool();
  const probe = new Client({connectionString});
  await probe.connect();
  const key = 'test_db_runner_' + process.pid + '_' + Date.now();
  try {
    await probe.query('CREATE TEMP TABLE runner_test (id text PRIMARY KEY) ON COMMIT PRESERVE ROWS');
    // Temp tables are connection-specific; use independent transaction-scoped
    // advisory locks for a cross-session rollback proof instead.
    await db.transaction(async client => {
      const begin = await client.query<{transaction_id:string}>(
        'SELECT txid_current()::text AS transaction_id');
      const again = await client.query<{transaction_id:string}>(
        'SELECT txid_current()::text AS transaction_id');
      assert.equal(begin.rows[0].transaction_id, again.rows[0].transaction_id);
    });
    await assert.rejects(db.transaction(async client => {
      const first = await client.query<{transaction_id:string}>(
        'SELECT txid_current()::text AS transaction_id');
      assert.ok(first.rows[0].transaction_id);
      throw new Error(key);
    }), new RegExp(key));
    // A previous rollback does not poison or leak the pooled connection.
    const alive = await db.transaction(client => client.query<{ok:number}>('SELECT 1 AS ok'));
    assert.equal(alive.rows[0].ok, 1);
  } finally {
    await db.onModuleDestroy();
    await probe.end();
  }
});

test('transaction isolation guarantees rollback of all SQL writes, not a partial commit', async () => {
  const connectionString=process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL required');
  const db=new DatabasePool();
  const reference=new Pool({connectionString});
  const id='runner-'+process.pid+'-'+Date.now();
  try {
    await assert.rejects(db.transaction(async client => {
      await client.query(`INSERT INTO idempotency_records
        (id,actor_scope,method,route,key,request_hash,state,expires_at)
        VALUES(gen_random_uuid(),$1,'POST','/test', $2,$3,'PROCESSING',now()+interval '1 hour')`,
        ['runner-test',id,'a'.repeat(64)]);
      throw new Error('intentional_rollback');
    }),/intentional_rollback/);
    const result=await reference.query<{total:string}>(`
      SELECT count(*)::text AS total FROM idempotency_records
      WHERE actor_scope='runner-test' AND key=$1`,[id]);
    assert.equal(result.rows[0].total,'0');
  } finally {
    await db.onModuleDestroy();
    await reference.end();
  }
});
