import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {
  cancelAuthorizedPendingRequest,PendingCancellationRejected,
} from '../src/modules/requests/pending-cancellation.transaction.js';

async function fixtures(db:Client,opts:{guest?:boolean;status?:'PENDING'|'ACCEPTED'}={}){
  const userId=randomUUID(),personId=randomUUID(),organizationId=randomUUID();
  const definitionId=randomUUID(),offerId=randomUUID(),guestId=randomUUID();
  const requestId=randomUUID();
  await db.query('INSERT INTO users(id) VALUES($1)',[userId]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[personId,userId]);
  await db.query(`INSERT INTO organizations(id,owner_person_id,slug,name,status)
    VALUES($1,$2,$3,'Cancel fixture','ACTIVE')`,
    [organizationId,personId,'cancel-fixture-'+randomUUID()]);
  await db.query(`INSERT INTO service_definitions(id,code,name)
    VALUES($1,$2,'Service')`,[definitionId,'cancel-test-'+randomUUID()]);
  await db.query(`INSERT INTO service_offers
    (id,definition_id,organization_id,title,status,delivery_mode,contacts)
    VALUES($1,$2,$3,'Offer','PUBLISHED','online','{}'::jsonb)`,
    [offerId,definitionId,organizationId]);
  if(opts.guest){
    await db.query(`INSERT INTO guest_contacts
      (id,channel,encrypted_value,digest,verified_at,expires_at)
      VALUES($1,'email','encrypted',$2,now(),now()+interval '1 day')`,
      [guestId,'cancel-test-'+randomUUID()]);
  }
  await db.query(`INSERT INTO service_requests
    (id,offer_id,customer_person_id,guest_contact_id,source_context,
     seller_organization_id,status)
    VALUES($1,$2,$3,$4,'ORGANIZATION',$5,$6::"RequestStatus")`,
    [requestId,offerId,opts.guest?null:personId,
     opts.guest?guestId:null,organizationId,opts.status??'PENDING']);
  return {requestId,personId,organizationId,guestId};
}
async function inRollback(testCase:(db:Client)=>Promise<void>){
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');
  try{await testCase(db);}
  finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
}
async function ledger(db:Client,requestId:string){
  const result=await db.query<{status:string;version:number;events:string;
    notices:string;reliability:string;outbox:string}>(`
    SELECT r.status::text,r.version,
      (SELECT count(*)::text FROM cancellation_events c WHERE c.request_id=r.id) AS events,
      (SELECT count(*)::text FROM notification_intents n
        JOIN cancellation_events c ON n.cancellation_id=c.id
        WHERE c.request_id=r.id) AS notices,
      (SELECT count(*)::text FROM reliability_events re
        WHERE re.request_id=r.id) AS reliability,
      (SELECT count(*)::text FROM domain_outbox_events e
        WHERE e.subject_id=r.id AND e.topic='service_request.cancelled') AS outbox
    FROM service_requests r WHERE id=$1`,[requestId]);
  return result.rows[0];
}

test('registered customer cancels pending: exactly two intents and one outbox event',async()=>{
  await inRollback(async db=>{
    const f=await fixtures(db);
    const result=await cancelAuthorizedPendingRequest(db,f.requestId,
      {side:'customer',kind:'person',personId:f.personId},1);
    assert.equal(result.state,'cancelled_by_customer');
    assert.equal(result.version,2);
    const values=await ledger(db,f.requestId);
    assert.deepEqual([values.status,values.version,values.events,values.notices,
      values.reliability,values.outbox],
      ['CANCELLED_BY_CUSTOMER',2,'1','2','0','1']);
    const notices=await db.query<{audience:string;recipient_org_id:string|null;
      recipient_person_id:string|null;channel:string}>(`
      SELECT n.audience,n.recipient_org_id::text,n.recipient_person_id::text,
             n.channel FROM notification_intents n
      WHERE n.cancellation_id=$1 ORDER BY audience`,[result.cancellationId]);
    assert.deepEqual(notices.rows.map(x=>x.audience),['COUNTERPARTY','INITIATOR']);
    assert.equal(notices.rows[0].recipient_org_id,f.organizationId);
    assert.equal(notices.rows[1].recipient_person_id,f.personId);
    assert.ok(notices.rows.every(x=>x.channel==='IN_APP'));
    await assert.rejects(cancelAuthorizedPendingRequest(db,f.requestId,
      {side:'customer',kind:'person',personId:f.personId},1),
      (e:unknown)=>e instanceof PendingCancellationRejected&&e.reason==='conflict');
    assert.equal((await ledger(db,f.requestId)).notices,'2');
  });
});
test('provider cancels registered customer pending with two IN_APP audiences',async()=>{
  await inRollback(async db=>{
    const f=await fixtures(db);
    const result=await cancelAuthorizedPendingRequest(db,f.requestId,
      {side:'provider',kind:'organization',sellerId:f.organizationId},1);
    assert.equal(result.state,'cancelled_by_provider');
    const notices=await db.query<{audience:string;channel:string;
      recipient_person_id:string|null;recipient_org_id:string|null}>(`
      SELECT audience,channel,recipient_person_id::text,
             recipient_org_id::text FROM notification_intents
      WHERE cancellation_id=$1 ORDER BY audience`,[result.cancellationId]);
    assert.deepEqual(notices.rows.map(x=>[x.audience,x.channel]),[
      ['COUNTERPARTY','IN_APP'],['INITIATOR','IN_APP'],
    ]);
    assert.equal(notices.rows[0].recipient_person_id,f.personId);
    assert.equal(notices.rows[1].recipient_org_id,f.organizationId);
    assert.equal((await ledger(db,f.requestId)).reliability,'0');
  });
});
test('unauthorized actor, stale version and accepted requests cannot mutate',async()=>{
  await inRollback(async db=>{
    const f=await fixtures(db);
    for(const [principal,version,reason] of [
      [{side:'customer',kind:'person',personId:randomUUID()},1,'forbidden'],
      [{side:'provider',kind:'organization',sellerId:randomUUID()},1,'forbidden'],
      [{side:'customer',kind:'person',personId:f.personId},4,'conflict'],
    ] as const){
      await assert.rejects(cancelAuthorizedPendingRequest(db,f.requestId,
        principal,version),(e:unknown)=>e instanceof PendingCancellationRejected&&
          e.reason===reason);
    }
    assert.deepEqual([...(Object.values(await ledger(db,f.requestId)))].slice(0,2),
      ['PENDING',1]);
    assert.equal((await ledger(db,f.requestId)).events,'0');
  });
  await inRollback(async db=>{
    const f=await fixtures(db,{status:'ACCEPTED'});
    await assert.rejects(cancelAuthorizedPendingRequest(db,f.requestId,
      {side:'customer',kind:'person',personId:f.personId},1),
      (e:unknown)=>e instanceof PendingCancellationRejected&&e.reason==='conflict');
    assert.equal((await ledger(db,f.requestId)).events,'0');
  });
});
test('guest cancellation cannot bypass separate READ_CANCEL capability validation',async()=>{
  await inRollback(async db=>{
    const f=await fixtures(db,{guest:true});
    await assert.rejects(cancelAuthorizedPendingRequest(db,f.requestId,
      {side:'provider',kind:'organization',sellerId:f.organizationId},1),
      (e:unknown)=>e instanceof PendingCancellationRejected&&e.reason==='undeliverable');
    const values=await ledger(db,f.requestId);
    assert.equal(values.status,'PENDING');
    assert.equal(values.events,'0');
    assert.equal(values.notices,'0');
  });
});
