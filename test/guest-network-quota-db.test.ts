import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {
  NETWORK_SEND_QUOTA,verifyTrustedNetworkProof,
  checkNetworkSendQuota,recordNetworkSend,
} from '../src/modules/guest-requests/guest-network-quota.js';

function proof(key:Buffer,digest:string,at:number):string{
  const stamp=String(at);
  const mac=createHmac('sha256',key).update('services-otp-network:v1\n')
    .update(digest).update('\n').update(stamp).digest('hex');
  return 'v1.'+digest+'.'+stamp+'.'+mac;
}

test('only a fresh signed trusted-edge digest can be used',()=>{
  const key=randomBytes(32),digest=randomBytes(32).toString('hex');
  const now=Date.parse('2026-11-04T10:00:00.000Z');
  const signed=proof(key,digest,now);
  assert.equal(verifyTrustedNetworkProof(signed,key,now),digest);
  assert.equal(verifyTrustedNetworkProof(signed,key,now+30001),null);
  assert.equal(verifyTrustedNetworkProof(signed,randomBytes(32),now),null);
  assert.equal(verifyTrustedNetworkProof(signed.replace(digest,'0'.repeat(64)),key,now),null);
  assert.equal(verifyTrustedNetworkProof('X-Forwarded-For: 127.0.0.1',key,now),null);
  assert.equal(verifyTrustedNetworkProof(undefined,key,now),null);
  assert.equal(verifyTrustedNetworkProof(signed,Buffer.alloc(12),now),null);
});

test('network quota holds advisory lock before reading 24-hour history',async()=>{
  const digest=randomBytes(32).toString('hex');
  const statements:string[]=[];
  const db={query:async(sql:string)=>{
    statements.push(sql);
    return {rows:[{minute_count:'1',hour_count:'2',day_count:'3'}]};
  }} as never;
  const result=await checkNetworkSendQuota(db,digest);
  assert.equal(result.allowed,true);
  assert.match(statements[0],/pg_advisory_xact_lock/);
  assert.match(statements[1],/guest_otp_network_issuances/);
  assert.match(statements[1],/interval '24 hours'/);
  assert.doesNotMatch(statements.join(' '),/X-Forwarded-For|contact_value/);
});

test('network quota fails closed at minute, hour, day and invalid count',async()=>{
  for(const [row,expected] of [
    [{minute_count:'5',hour_count:'5',day_count:'5'},'network_minute'],
    [{minute_count:'1',hour_count:'20',day_count:'20'},'network_hourly'],
    [{minute_count:'1',hour_count:'2',day_count:'50'},'network_daily'],
  ] as const){
    const db={query:async(sql:string)=>({
      rows:sql.includes('pg_advisory_xact_lock')?[]:[row],
    })} as never;
    const result=await checkNetworkSendQuota(db,'a'.repeat(64));
    assert.equal(result.allowed,false);
    assert.equal(result.reason,expected);
  }
  const invalid={query:async()=>({rows:[{
    minute_count:'broken',hour_count:'0',day_count:'0',
  }]})} as never;
  await assert.rejects(checkNetworkSendQuota(invalid,'a'.repeat(64)));
  await assert.rejects(checkNetworkSendQuota(invalid,'not-a-digest'));
  assert.equal(NETWORK_SEND_QUOTA.perMinute,5);
});

test('PostgreSQL network budget blocks a burst across contacts and isolates other networks',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const client=new Client({connectionString:process.env.DATABASE_URL});
  const digest=randomBytes(32).toString('hex');
  const otherDigest=randomBytes(32).toString('hex');
  await client.connect();
  await client.query('BEGIN');
  try{
    const initial=await checkNetworkSendQuota(client,digest);
    assert.equal(initial.allowed,true);
    for(let i=0;i<NETWORK_SEND_QUOTA.perMinute;i++){
      await recordNetworkSend(client,digest);
    }
    const blocked=await checkNetworkSendQuota(client,digest);
    assert.equal(blocked.allowed,false);
    assert.equal(blocked.reason,'network_minute');
    assert.equal((await checkNetworkSendQuota(client,otherDigest)).allowed,true);
    const rows=await client.query<{n:string}>(`
      SELECT count(*)::text n FROM guest_otp_network_issuances
      WHERE network_digest=$1
    `,[digest]);
    assert.equal(rows.rows[0].n,String(NETWORK_SEND_QUOTA.perMinute));
  }finally{
    await client.query('ROLLBACK').catch(()=>{});
    await client.end();
  }
});
