import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {checkGlobalSendQuota,GLOBAL_SEND_QUOTA} from '../src/modules/guest-requests/guest-global-quota.js';

test('global quota checks hold PostgreSQL advisory lock before counting',async()=>{
  const statements:string[]=[];
  const db={query:async(sql:string)=>{
    statements.push(sql);
    return {rows:[{minute_count:'1',hour_count:'2',day_count:'3'}]};
  }} as never;
  const result=await checkGlobalSendQuota(db,new Date('2026-11-04T12:00:00.000Z'));
  assert.equal(result.allowed,true);
  assert.match(statements[0],/pg_advisory_xact_lock/);
  assert.match(statements[1],/FROM guest_challenges/);
  assert.match(statements[1],/purpose='CREATE_REQUEST'/);
  assert.match(statements[1],/interval '24 hours'/);
});

test('global budget fails closed for minute/hour/day, invalid counts and time',async()=>{
  for(const [row,reason] of [
    [{minute_count:'30',hour_count:'30',day_count:'30'},'global_minute'],
    [{minute_count:'3',hour_count:'300',day_count:'300'},'global_hourly'],
    [{minute_count:'3',hour_count:'30',day_count:'3000'},'global_daily'],
  ] as const){
    const db={query:async(sql:string)=>({
      rows:sql.includes('pg_advisory_xact_lock')?[]:[row],
    })} as never;
    const result=await checkGlobalSendQuota(db);
    assert.equal(result.allowed,false);
    assert.equal(result.reason,reason);
    assert.ok(result.retryAfterSeconds>0);
  }
  const db={query:async()=>({rows:[{
    minute_count:'invalid',hour_count:'0',day_count:'0',
  }]})} as never;
  await assert.rejects(checkGlobalSendQuota(db),/invalid_quota_counts/);
  await assert.rejects(checkGlobalSendQuota(db,new Date(NaN)),/invalid_time/);
  assert.equal(GLOBAL_SEND_QUOTA.perMinute,30);
});

test('real PostgreSQL global budget counts committed-schema challenges and blocks burst',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();
  await db.query('BEGIN');
  try{
    const now=new Date();
    const initial=await checkGlobalSendQuota(db,now);
    assert.equal(initial.allowed,true);
    // These rows and their contacts are rolled back, never sent to a provider.
    // A unique test transaction holds the global lock until ROLLBACK.
    for(let i=0;i<GLOBAL_SEND_QUOTA.perMinute;i++){
      const contactId=randomUUID();
      await db.query(`
        INSERT INTO guest_contacts(id,channel,encrypted_value,digest,expires_at)
        VALUES($1,'email','encrypted-test-only',$2,now()+interval '1 day')`,
        [contactId,randomBytes(32).toString('hex')]);
      await db.query(`
        INSERT INTO guest_challenges(id,guest_contact_id,code_hash,purpose,expires_at)
        VALUES($1,$2,$3,'CREATE_REQUEST',now()+interval '10 minutes')`,
        [randomUUID(),contactId,'0'.repeat(64)]);
    }
    const blocked=await checkGlobalSendQuota(db,new Date());
    assert.equal(blocked.reason,'global_minute');
    assert.equal(blocked.allowed,false);
  }finally{
    await db.query('ROLLBACK').catch(()=>{});
    await db.end();
  }
});
