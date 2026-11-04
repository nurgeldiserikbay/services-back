import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {cancelAcceptedLateByRegisteredCustomer,LateCancellationRejected}
  from '../src/modules/requests/accepted-late-cancellation.transaction.js';

const approved={formulaVersion:'reviewed_v1',
  lateCustomerWeight:'1.25',approvalId:'APPROVAL-2026-001'};
async function rollback(run:(db:Client)=>Promise<void>){
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');
  try{await run(db);}finally{
    await db.query('ROLLBACK').catch(()=>{});await db.end();
  }
}
async function fixture(db:Client,opts:{free?:boolean;suspended?:boolean;
  snapshot?:boolean}={}){
  const user=randomUUID(),person=randomUUID(),org=randomUUID();
  const def=randomUUID(),offer=randomUUID(),request=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query(`INSERT INTO organizations(id,owner_person_id,slug,name,status)
    VALUES($1,$2,$3,'Seller','ACTIVE')`,
    [org,person,'late-cancel-'+randomUUID()]);
  await db.query(`INSERT INTO service_definitions(id,code,name)
    VALUES($1,$2,'Service')`,[def,'late-cancel-'+randomUUID()]);
  await db.query(`INSERT INTO service_offers
    (id,definition_id,organization_id,title,status,delivery_mode,contacts)
    VALUES($1,$2,$3,'Offer','PUBLISHED','online','{}'::jsonb)`,
    [offer,def,org]);
  const accepted=new Date(Date.now()-3600000);
  const start=new Date(Date.now()+48*3600000);
  const end=new Date(start.getTime()+3600000);
  const deadline=new Date(Date.now()+(opts.free?3600000:-3600000));
  await db.query(`INSERT INTO service_requests
    (id,offer_id,customer_person_id,source_context,seller_organization_id,
     status,accepted_at,scheduled_start_at,scheduled_end_at,timezone,
     customer_penalty_suspended)
    VALUES($1,$2,$3,'ORGANIZATION',$4,'ACCEPTED',$5,$6,$7,'Asia/Almaty',$8)
  `,[request,offer,person,org,accepted,start,end,opts.suspended??false]);
  if(opts.snapshot!==false){
    await db.query(`INSERT INTO cancellation_snapshots
      (request_id,policy_revision,scheduled_start_at,free_cancel_before_min,
       free_cancel_until,accepted_at,timezone)
      VALUES($1,1,$2,120,$3,$4,'Asia/Almaty')
    `,[request,start,deadline,accepted]);
  }
  return {request,person,org};
}
async function counts(db:Client,request:string){
  const r=await db.query<{status:string;version:number;notices:string;
    penalties:string;events:string;outbox:string}>(`
    SELECT status::text,version,
      (SELECT count(*)::text FROM notification_intents n
        JOIN cancellation_events c ON c.id=n.cancellation_id
        WHERE c.request_id=service_requests.id) notices,
      (SELECT count(*)::text FROM reliability_events re
        WHERE re.request_id=service_requests.id) penalties,
      (SELECT count(*)::text FROM cancellation_events c
        WHERE c.request_id=service_requests.id) events,
      (SELECT count(*)::text FROM domain_outbox_events e
        WHERE e.subject_id=service_requests.id
        AND e.topic='service_request.cancelled') outbox
    FROM service_requests WHERE id=$1`,[request]);
  return r.rows[0];
}
test('late cancellation commits two intents, one proposed rating, outbox and no effective score',async()=>{
  await rollback(async db=>{
    const f=await fixture(db);
    const result=await cancelAcceptedLateByRegisteredCustomer(
      db,f.request,f.person,1,approved);
    assert.equal(result.reliabilityProposed,true);
    assert.equal(result.version,2);
    assert.deepEqual(await counts(db,f.request),{
      status:'CANCELLED_BY_CUSTOMER',version:2,
      notices:'2',penalties:'1',events:'1',outbox:'1',
    });
    const rating=await db.query<{status:string;weight:string;
      formula_version:string;customer_person_id:string}>(`
      SELECT status::text,weight::text,formula_version,
        customer_person_id::text FROM reliability_events
      WHERE request_id=$1`,[f.request]);
    assert.equal(rating.rows[0].status,'PROPOSED');
    assert.equal(rating.rows[0].weight,'1.25');
    assert.equal(rating.rows[0].formula_version,approved.formulaVersion);
    assert.equal(rating.rows[0].customer_person_id,f.person);
    await assert.rejects(cancelAcceptedLateByRegisteredCustomer(
      db,f.request,f.person,1,approved),
      (e:unknown)=>e instanceof LateCancellationRejected&&e.reason==='conflict');
    assert.equal((await counts(db,f.request)).notices,'2');
  });
});
test('suspended customer can cancel late without automatic reliability proposal',async()=>{
  await rollback(async db=>{
    const f=await fixture(db,{suspended:true});
    const result=await cancelAcceptedLateByRegisteredCustomer(
      db,f.request,f.person,1,approved);
    assert.equal(result.reliabilityProposed,false);
    assert.equal((await counts(db,f.request)).penalties,'0');
    assert.equal((await counts(db,f.request)).notices,'2');
  });
});
test('no snapshot, free window, foreign owner and stale version are rejected before writes',async()=>{
  for(const opt of [{snapshot:false},{free:true},{}]){
    await rollback(async db=>{
      const f=await fixture(db,opt);
      await assert.rejects(cancelAcceptedLateByRegisteredCustomer(
        db,f.request,opt.snapshot===false||opt.free?f.person:randomUUID(),
        opt.snapshot===false||opt.free?1:1,approved),
        LateCancellationRejected);
      const ledger=await counts(db,f.request);
      assert.equal(ledger.status,'ACCEPTED');
      assert.equal(ledger.events,'0');
      assert.equal(ledger.notices,'0');
      assert.equal(ledger.penalties,'0');
    });
  }
});
