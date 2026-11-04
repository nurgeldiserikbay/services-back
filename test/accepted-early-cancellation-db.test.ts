import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {
  cancelAcceptedEarlyByCustomer,EarlyCancellationRejected,
} from '../src/modules/requests/accepted-early-cancellation.transaction.js';

async function withRollback(run:(db:Client)=>Promise<void>){
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');
  try{await run(db);}finally{
    await db.query('ROLLBACK').catch(()=>{});await db.end();
  }
}
async function fixture(db:Client,options:{snapshot?:boolean;late?:boolean}={}){
  const user=randomUUID(),person=randomUUID(),org=randomUUID();
  const definition=randomUUID(),offer=randomUUID(),request=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query(`INSERT INTO organizations(id,owner_person_id,slug,name,status)
    VALUES($1,$2,$3,'Seller','ACTIVE')`,[org,person,'accepted-cancel-'+randomUUID()]);
  await db.query(`INSERT INTO service_definitions(id,code,name)
    VALUES($1,$2,'Service')`,[definition,'accepted-cancel-'+randomUUID()]);
  await db.query(`INSERT INTO service_offers
    (id,definition_id,organization_id,title,status,delivery_mode,contacts)
    VALUES($1,$2,$3,'Offer','PUBLISHED','online','{}'::jsonb)`,
    [offer,definition,org]);
  const accepted=new Date(Date.now()-3600000);
  const start=new Date(Date.now()+48*3600000);
  const end=new Date(start.getTime()+3600000);
  const cutoff=new Date(Date.now()+(options.late?-3600000:24*3600000));
  await db.query(`INSERT INTO service_requests
    (id,offer_id,customer_person_id,source_context,
     seller_organization_id,status,accepted_at,
     scheduled_start_at,scheduled_end_at,timezone)
    VALUES($1,$2,$3,'ORGANIZATION',$4,'ACCEPTED',$5,$6,$7,'Asia/Almaty')`,
    [request,offer,person,org,accepted,start,end]);
  if(options.snapshot!==false){
    await db.query(`INSERT INTO cancellation_snapshots
      (request_id,policy_revision,scheduled_start_at,free_cancel_before_min,
       free_cancel_until,accepted_at,timezone)
      VALUES($1,1,$2,120,$3,$4,'Asia/Almaty')`,
      [request,start,cutoff,accepted]);
  }
  return {request,person,org};
}

test('early accepted cancellation writes two intents, no penalty and releases request allocations',async()=>{
  await withRollback(async db=>{
    const f=await fixture(db);
    const result=await cancelAcceptedEarlyByCustomer(db,f.request,f.person,1);
    assert.equal(result.state,'cancelled_by_customer');
    assert.equal(result.version,2);
    const rows=await db.query<{status:string;version:number}>(`
      SELECT status::text,version FROM service_requests WHERE id=$1`,[f.request]);
    assert.deepEqual(rows.rows[0],{status:'CANCELLED_BY_CUSTOMER',version:2});
    const notices=await db.query<{audience:string;recipient_person_id:string|null;
      recipient_org_id:string|null}>(`
      SELECT audience,recipient_person_id::text,recipient_org_id::text
      FROM notification_intents WHERE cancellation_id=$1 ORDER BY audience`,
      [result.cancellationId]);
    assert.deepEqual(notices.rows.map(x=>x.audience),[
      'COUNTERPARTY','INITIATOR',
    ]);
    assert.equal(notices.rows[0].recipient_org_id,f.org);
    assert.equal(notices.rows[1].recipient_person_id,f.person);
    const penalty=await db.query<{count:string}>(`
      SELECT count(*)::text AS count FROM reliability_events WHERE request_id=$1
    `,[f.request]);
    assert.equal(penalty.rows[0].count,'0');
    await assert.rejects(cancelAcceptedEarlyByCustomer(db,f.request,f.person,1),
      (e:unknown)=>e instanceof EarlyCancellationRejected&&e.reason==='conflict');
    const events=await db.query<{count:string}>(`
      SELECT count(*)::text AS count FROM cancellation_events WHERE request_id=$1
    `,[f.request]);
    assert.equal(events.rows[0].count,'1');
  });
});

test('late or unsnapshotted accepted appointment is not auto-cancelled',async()=>{
  for(const option of [{late:true},{snapshot:false}]){
    await withRollback(async db=>{
      const f=await fixture(db,option);
      await assert.rejects(cancelAcceptedEarlyByCustomer(db,f.request,f.person,1),
        (e:unknown)=>e instanceof EarlyCancellationRejected&&e.reason==='conflict');
      const row=await db.query<{status:string}>(`
        SELECT status::text FROM service_requests WHERE id=$1`,[f.request]);
      assert.equal(row.rows[0].status,'ACCEPTED');
    });
  }
});

test('wrong owner and stale version do not emit events or notices',async()=>{
  await withRollback(async db=>{
    const f=await fixture(db);
    await assert.rejects(cancelAcceptedEarlyByCustomer(db,f.request,randomUUID(),1),
      (e:unknown)=>e instanceof EarlyCancellationRejected&&e.reason==='unavailable');
    await assert.rejects(cancelAcceptedEarlyByCustomer(db,f.request,f.person,9),
      (e:unknown)=>e instanceof EarlyCancellationRejected&&e.reason==='conflict');
    const count=await db.query<{count:string}>(`
      SELECT count(*)::text AS count FROM cancellation_events WHERE request_id=$1
    `,[f.request]);
    assert.equal(count.rows[0].count,'0');
  });
});
