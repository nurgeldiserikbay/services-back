import assert from 'node:assert/strict';
import test from 'node:test';
import {Pool} from 'pg';

/**
 * Exercises the actual PostgreSQL locking and rollback semantics used by
 * schedule-proposal transactions. No application fixture data is required.
 */
test('schedule advisory lock serializes concurrent transactions and rollback releases it', {
  skip: !process.env.DATABASE_URL,
  timeout: 15_000,
}, async () => {
  const pool = new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:3000});
  const first = await pool.connect();
  const second = await pool.connect();
  let firstOpen=false;
  let secondOpen=false;
  try {
    await first.query('BEGIN');
    firstOpen=true;
    await first.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[
      'schedule-integration-actor','schedule-integration-route:key',
    ]);
    await second.query('BEGIN');
    secondOpen=true;
    await second.query("SET LOCAL lock_timeout = '200ms'");
    await assert.rejects(
      second.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[
        'schedule-integration-actor','schedule-integration-route:key',
      ]),
      (error:unknown)=>typeof error==='object'&&error!==null&&
        'code' in error&&error.code==='55P03',
    );
    // A lock timeout aborts the second transaction; releasing the first lock
    // must allow a new transaction to acquire the same advisory lock.
    await second.query('ROLLBACK');
    secondOpen=false;
    await first.query('ROLLBACK');
    firstOpen=false;
    await second.query('BEGIN');
    secondOpen=true;
    await second.query("SET LOCAL lock_timeout = '2s'");
    await second.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[
      'schedule-integration-actor','schedule-integration-route:key',
    ]);
  } finally {
    if(secondOpen)await second.query('ROLLBACK');
    if(firstOpen)await first.query('ROLLBACK');
    second.release();
    first.release();
    await pool.end();
  }
});

test('PostgreSQL transaction rollback removes schedule-like event and outbox writes', {
  skip: !process.env.DATABASE_URL,
  timeout: 15_000,
}, async () => {
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:3000});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE schedule_tx_atomicity (kind text NOT NULL) ON COMMIT PRESERVE ROWS');
    await client.query('COMMIT');
    await client.query('BEGIN');
    await client.query("INSERT INTO schedule_tx_atomicity(kind) VALUES ('event'),('outbox'),('notification')");
    await client.query('ROLLBACK');
    const result=await client.query('SELECT count(*)::int AS count FROM schedule_tx_atomicity');
    assert.equal(result.rows[0]?.count,0);
  } finally {
    client.release();
    await pool.end();
  }
});
