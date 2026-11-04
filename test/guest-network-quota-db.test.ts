import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {verifyTrustedNetworkAssertion} from '../src/modules/guest-requests/guest-network-assertion.js';
import {checkNetworkSendQuota,NETWORK_SEND_QUOTA} from '../src/modules/guest-requests/guest-network-quota.js';

const key=randomBytes(32),now=Date.now();
const digest='b'.repeat(64);
function sign(bucket=digest,t=now){
  const signature=createHmac('sha256',key)
    .update('guest-network-assertion:v1\0')
    .update(String(t)).update('\0').update(bucket).digest('hex');
  return `v1.${t}.${bucket}.${signature}`;
}
test('signed ingress proof rejects forged, stale and missing identities',()=>{
  const secret=key.toString('base64');
  assert.equal(verifyTrustedNetworkAssertion(sign(),secret,now),digest);
  assert.equal(verifyTrustedNetworkAssertion(sign(),randomBytes(32).toString('base64'),now),null);
  assert.equal(verifyTrustedNetworkAssertion(sign(),undefined,now),null);
  assert.equal(verifyTrustedNetworkAssertion(sign(digest,now-31000),secret,now),null);
  assert.equal(verifyTrustedNetworkAssertion(sign(digest,now+31000),secret,now),null);
  assert.equal(verifyTrustedNetworkAssertion(sign('c'.repeat(64)),secret,now), 'c'.repeat(64));
  assert.equal(verifyTrustedNetworkAssertion(sign().replace(digest,'a'.repeat(64)),secret,now),null);
  for(const malformed of [undefined,'', 'v1.fake','1.2.3.4',
    'x-forwarded-for: 127.0.0.1', 'x'.repeat(300)]){
    assert.equal(verifyTrustedNetworkAssertion(malformed,secret,now),null);
  }
});
test('network quota uses a PG transaction advisory lock and fails closed',async()=>{
  const statements:string[]=[];
  const client={query:async(sql:string)=>{
    statements.push(sql);
    return {rows:[{minute_count:'5',hour_count:'5',day_count:'5'}]};
  }} as never;
  const limited=await checkNetworkSendQuota(client,digest,new Date(now));
  assert.equal(limited.allowed,false);
  assert.equal(limited.reason,'network_minute');
  assert.match(statements[0],/pg_advisory_xact_lock/);
  assert.match(statements[1],/guest_otp_network_events/);
  await assert.rejects(checkNetworkSendQuota(client,'bad'),/invalid_network_digest/);
  assert.equal(NETWORK_SEND_QUOTA.perMinute,5);
});

test('PostgreSQL network quota counts atomic issued challenges and distinguishes networks',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();
  await db.query('BEGIN');
  try{
    let quota=await checkNetworkSendQuota(db,digest,new Date());
    assert.equal(quota.allowed,true);
    for(let i=0;i<NETWORK_SEND_QUOTA.perMinute;i++){
      const contact=randomUUID(),challenge=randomUUID();
      await db.query(`
        INSERT INTO guest_contacts(id,channel,encrypted_value,digest,expires_at)
        VALUES($1,'email','fixture',$2,now()+interval '1 day')`,
        [contact,randomBytes(32).toString('hex')]);
      await db.query(`
        INSERT INTO guest_challenges(id,guest_contact_id,code_hash,purpose,expires_at)
        VALUES($1,$2,$3,'CREATE_REQUEST',now()+interval '10 minutes')`,
        [challenge,contact,'a'.repeat(64)]);
      await db.query(`
        INSERT INTO guest_otp_network_events(id,network_digest,challenge_id)
        VALUES($1,$2,$3)`,[randomUUID(),digest,challenge]);
    }
    quota=await checkNetworkSendQuota(db,digest,new Date());
    assert.equal(quota.reason,'network_minute');
    assert.equal(quota.allowed,false);
    const other=await checkNetworkSendQuota(db,'c'.repeat(64),new Date());
    assert.equal(other.allowed,true);
  }finally{
    await db.query('ROLLBACK').catch(()=>{});
    await db.end();
  }
});
