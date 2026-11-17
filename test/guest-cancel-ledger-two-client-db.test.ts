import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';

/**
 * Two independent PostgreSQL sessions prove the unique ledger constraint
 * serializes identical cancellation key reservations. This tests the ledger
 * concurrency primitive, NOT the authenticated guest cancellation HTTP flow.
 */
test('two connections: concurrent cancellation ledger reservation blocks and rollback permits retry',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const first=new Client({connectionString:process.env.DATABASE_URL});
  const second=new Client({connectionString:process.env.DATABASE_URL});
  await first.connect();await second.connect();
  const suffix=randomUUID(),scope='guest-cancel:race-'+suffix;
  const route='/v1/requests/'+suffix+'/cancel',key='guest-cancel-v1';
  const hash='a'.repeat(64);
  const reserve=`
    INSERT INTO idempotency_records
      (id,actor_scope,method,route,key,request_hash,state,expires_at)
    VALUES($1,$2,'POST',$3,$4,$5,'PROCESSING',now()+interval '1 day')
    ON CONFLICT (actor_scope,method,route,key) DO NOTHING
    RETURNING id::text
  `;
  try{
    await first.query('BEGIN');
    await second.query('BEGIN');
    const owner=await first.query<{id:string}>(reserve,[
      randomUUID(),scope,route,key,hash]);
    assert.equal(owner.rows.length,1);
    // A different connection must NOT claim the identical idempotency key
    // while the first writer owns an uncommitted unique index entry.
    await second.query('SAVEPOINT concurrent_attempt');
    await second.query("SET LOCAL statement_timeout='700ms'");
    await assert.rejects(second.query(reserve,[
      randomUUID(),scope,route,key,hash]),(err:unknown)=>
        Boolean(err&&typeof err==='object'&&
          (err as {code?:string}).code==='57014'));
    await second.query('ROLLBACK TO SAVEPOINT concurrent_attempt');
    // Abort the owner: the second caller must be able to reserve the key
    // and must NOT observe a phantom COMPLETED cancellation.
    await first.query('ROLLBACK');
    const next=await second.query<{id:string}>(reserve,[
      randomUUID(),scope,route,key,hash]);
    assert.equal(next.rows.length,1);
    const live=await second.query<{state:string;request_hash:string}>(`
      SELECT state,request_hash FROM idempotency_records
      WHERE actor_scope=$1 AND method='POST' AND route=$2 AND key=$3
    `,[scope,route,key]);
    assert.deepEqual(live.rows,[{state:'PROCESSING',request_hash:hash}]);
    await second.query('ROLLBACK');
    const after=await first.query<{n:string}>(`
      SELECT count(*)::text n FROM idempotency_records
      WHERE actor_scope=$1 AND method='POST' AND route=$2 AND key=$3
    `,[scope,route,key]);
    assert.equal(after.rows[0].n,'0',
      'neither abandoned reservation may become durable');
  }finally{
    await Promise.allSettled([
      first.query('ROLLBACK'),second.query('ROLLBACK')]);
    await Promise.allSettled([first.end(),second.end()]);
  }
});
