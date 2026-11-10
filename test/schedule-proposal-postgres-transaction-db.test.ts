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

test('PostgreSQL exclusion conflict rolls back schedule event and calendar reservation together', {
  skip: !process.env.DATABASE_URL,
  timeout: 15_000,
}, async () => {
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:3000});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE schedule_calendar_overlap (
        slot tstzrange NOT NULL,
        EXCLUDE USING gist (slot WITH &&)
      ) ON COMMIT PRESERVE ROWS
    `);
    await client.query('CREATE TEMP TABLE schedule_outbox_atomicity (kind text NOT NULL) ON COMMIT PRESERVE ROWS');
    await client.query(`
      INSERT INTO schedule_calendar_overlap(slot)
      VALUES (tstzrange('2027-01-01 10:00+00','2027-01-01 11:00+00','[)'))
    `);
    await client.query('COMMIT');
    await client.query('BEGIN');
    await client.query("INSERT INTO schedule_outbox_atomicity(kind) VALUES ('event'),('outbox')");
    await assert.rejects(
      client.query(`
        INSERT INTO schedule_calendar_overlap(slot)
        VALUES (tstzrange('2027-01-01 10:30+00','2027-01-01 11:30+00','[)'))
      `),
      (error:unknown)=>typeof error==='object'&&error!==null&&
        'code' in error&&error.code==='23P01',
    );
    await client.query('ROLLBACK');
    const outbox=await client.query('SELECT count(*)::int AS count FROM schedule_outbox_atomicity');
    const calendar=await client.query('SELECT count(*)::int AS count FROM schedule_calendar_overlap');
    assert.equal(outbox.rows[0]?.count,0);
    assert.equal(calendar.rows[0]?.count,1);
  } finally {
    await client.query('ROLLBACK').catch(()=>undefined);
    client.release();
    await pool.end();
  }
});

test('PostgreSQL half-open calendar ranges allow back-to-back reservations', {
  skip: !process.env.DATABASE_URL,
  timeout: 15_000,
}, async () => {
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:3000});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE schedule_calendar_adjacent (
        slot tstzrange NOT NULL,
        EXCLUDE USING gist (slot WITH &&)
      ) ON COMMIT DROP
    `);
    await client.query(`
      INSERT INTO schedule_calendar_adjacent(slot) VALUES
      (tstzrange('2027-01-01 10:00+00','2027-01-01 11:00+00','[)')),
      (tstzrange('2027-01-01 11:00+00','2027-01-01 12:00+00','[)'))
    `);
    const result=await client.query('SELECT count(*)::int AS count FROM schedule_calendar_adjacent');
    assert.equal(result.rows[0]?.count,2);
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK').catch(()=>undefined);
    client.release();
    await pool.end();
  }
});

test('migrated busy_blocks has the real exclusion constraint for known calendar slots', {
  skip: !process.env.DATABASE_URL,
  timeout: 15_000,
}, async () => {
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:3000});
  try {
    const result=await pool.query(`
      SELECT c.contype, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      WHERE c.conrelid='public.busy_blocks'::regclass
        AND c.conname='no_overlapping_known_busy_blocks'
    `);
    assert.equal(result.rows.length,1,'busy_blocks exclusion constraint must be deployed');
    assert.equal(result.rows[0]?.contype,'x');
    const definition=String(result.rows[0]?.definition);
    assert.match(definition,/EXCLUDE USING gist/i);
    assert.match(definition,/professional_id/i);
    assert.match(definition,/tstzrange/i);
    assert.match(definition,/WITH &&/i);
    assert.ok(definition.includes('[)'), 'calendar ranges must be half-open');
  } finally {
    await pool.end();
  }
});

test('migrated schedule revisions and idempotency scopes have unique indexes', {
  skip: !process.env.DATABASE_URL,
  timeout: 15_000,
}, async () => {
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:3000});
  try {
    const result=await pool.query(`
      SELECT tablename,indexname,indexdef
      FROM pg_indexes
      WHERE schemaname='public'
        AND indexname=ANY($1::text[])
    `,[[
      'schedule_proposals_request_id_revision_key',
      'idempotency_records_actor_scope_method_route_key_key',
      'cancellation_snapshot_revisions_request_id_schedule_revisio_key',
    ]]);
    const indexes=new Map(result.rows.map((row:{indexname:string;indexdef:string})=>[
      row.indexname,row.indexdef,
    ]));
    assert.equal(indexes.size,3,'all three uniqueness protections must be migrated');
    for(const definition of indexes.values()){
      assert.match(definition,/CREATE UNIQUE INDEX/i);
    }
    assert.match(indexes.get('schedule_proposals_request_id_revision_key')!,/request_id, revision/);
    assert.match(indexes.get('idempotency_records_actor_scope_method_route_key_key')!,/actor_scope, method, route, key/);
    assert.match(indexes.get('cancellation_snapshot_revisions_request_id_schedule_revisio_key')!,/request_id, schedule_revision/);
  } finally {
    await pool.end();
  }
});
