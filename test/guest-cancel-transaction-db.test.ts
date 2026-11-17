import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import type {DatabasePool} from '../src/platform/database/database.pool.js';
import {GuestCancellationService} from '../src/modules/requests/guest-cancel.service.js';
import {issueGuestCapability} from '../src/modules/guest-requests/guest-request.security.js';
import {cancelGuestRequestIdempotently} from '../src/modules/requests/guest-cancel-idempotency.transaction.js';
import {
  cancelVerifiedGuestRequest,GuestCancellationRejected,
} from '../src/modules/requests/guest-cancel.transaction.js';

const id=()=>randomUUID();
const secret=randomBytes(32);

async function fixtures(db:Client){
  const user=id(),person=id(),org=id(),definition=id(),offer=id();
  const guest=id(),otherGuest=id(),request=id();
  await db.query('INSERT INTO users(id) VALUES($1)',[user]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[person,user]);
  await db.query(`INSERT INTO organizations
    (id,owner_person_id,slug,name,status)
    VALUES($1,$2,$3,'Cancel fixture','ACTIVE')`,
    [org,person,'cancel-'+id()]);
  await db.query('INSERT INTO service_definitions(id,code,name) VALUES($1,$2,$3)',
    [definition,'cancel-'+id(),'Cancel fixture']);
  await db.query(`INSERT INTO service_offers
    (id,definition_id,organization_id,title,status,delivery_mode,contacts)
    VALUES($1,$2,$3,'Cancel offer','PUBLISHED','online',$4::jsonb)`,
    [offer,definition,org,JSON.stringify({methods:['guest_request']})]);
  for(const contact of [guest,otherGuest]){
    await db.query(`INSERT INTO guest_contacts
      (id,channel,encrypted_value,digest,verified_at,expires_at)
      VALUES($1,'email','encrypted',$2,now(),now()+interval '1 day')`,
      [contact,'cancel-'+id()]);
  }
  await db.query(`INSERT INTO service_requests
    (id,offer_id,guest_contact_id,source_context,
     seller_organization_id,status)
    VALUES($1,$2,$3,'ORGANIZATION',$4,'PENDING')`,
    [request,offer,guest,org]);
  const valid=issueGuestCapability('READ_CANCEL',secret);
  const foreign=issueGuestCapability('READ_CANCEL',secret);
  for(const [contact,proof] of [[guest,valid],[otherGuest,foreign]] as const)
    await db.query(`INSERT INTO guest_capabilities
      (id,guest_contact_id,request_id,scope,token_hash,expires_at)
      VALUES($1,$2,$3,'READ_CANCEL',$4,now()+interval '1 hour')`,
      [id(),contact,request,proof.tokenHash]);
  return {request,org,guest,valid:valid.token,foreign:foreign.token};
}
async function withFixture(fn:(db:Client,f:Awaited<ReturnType<typeof fixtures>>)=>Promise<void>){
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');
  try{await fn(db,await fixtures(db));}
  finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
}
test('verified guest pending cancel is a single transition with exactly two notice intents',async()=>{
  await withFixture(async(db,f)=>{
    const result=await cancelVerifiedGuestRequest(db,f.request,f.valid,1,secret);
    assert.deepEqual(result,{id:f.request,state:'cancelled_by_customer',version:2});
    const request=await db.query<{status:string;version:number}>(
      'SELECT status::text,version FROM service_requests WHERE id=$1',[f.request]);
    assert.deepEqual(request.rows[0],{status:'CANCELLED_BY_CUSTOMER',version:2});
    const cancellation=await db.query<{actor:string;is_late:boolean}>(`
      SELECT actor::text,is_late FROM cancellation_events WHERE request_id=$1
    `,[f.request]);
    assert.deepEqual(cancellation.rows,[{actor:'CUSTOMER',is_late:false}]);
    const intents=await db.query<{
      audience:string;channel:string;guest_contact_id:string|null;
      recipient_org_id:string|null;
    }>(`
      SELECT audience,channel,guest_contact_id::text,recipient_org_id::text
      FROM notification_intents
      WHERE cancellation_id IN
        (SELECT id FROM cancellation_events WHERE request_id=$1)
      ORDER BY audience
    `,[f.request]);
    assert.deepEqual(intents.rows,[
      {audience:'COUNTERPARTY',channel:'IN_APP',
       guest_contact_id:null,recipient_org_id:f.org},
      {audience:'INITIATOR',channel:'EMAIL',
       guest_contact_id:f.guest,recipient_org_id:null},
    ]);
    const events=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM domain_outbox_events
      WHERE subject_id=$1 AND topic='service_request.cancelled'
    `,[f.request]);
    assert.equal(events.rows[0].n,'1');
    const reliability=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM reliability_events WHERE request_id=$1
    `,[f.request]);
    assert.equal(reliability.rows[0].n,'0');
  });
});
test('wrong, foreign-contact or expired proof cannot cancel or query other guest',async()=>{
  await withFixture(async(db,f)=>{
    for(const token of [f.foreign,randomBytes(32).toString('base64url')]){
      await assert.rejects(cancelVerifiedGuestRequest(db,f.request,token,1,secret),
        (e:unknown)=>e instanceof GuestCancellationRejected&&
          e.reason==='unavailable');
    }
    await db.query('UPDATE guest_capabilities SET created_at=now()-interval \'2 hours\', expires_at=now()-interval \'1 hour\' WHERE request_id=$1',[f.request]);
    await assert.rejects(cancelVerifiedGuestRequest(db,f.request,f.valid,1,secret),
      GuestCancellationRejected);
    const row=await db.query<{status:string}>(
      'SELECT status::text FROM service_requests WHERE id=$1',[f.request]);
    assert.equal(row.rows[0].status,'PENDING');
  });
});
test('expired READ_CANCEL proof during one long transaction cannot cancel',async()=>{
  await withFixture(async(db,f)=>{
    await db.query(`
      UPDATE guest_capabilities
      SET expires_at=clock_timestamp()+interval '100 milliseconds'
      WHERE request_id=$1 AND token_hash IS NOT NULL
    `,[f.request]);
    // PostgreSQL now() is frozen at BEGIN; the security check must use
    // live clock time after this delay, even on the same connection.
    await db.query('SELECT pg_sleep(0.20)');
    await assert.rejects(
      cancelVerifiedGuestRequest(db,f.request,f.valid,1,secret),
      (error:unknown)=>error instanceof GuestCancellationRejected&&
        error.reason==='unavailable');
    const rows=await db.query<{state:string}>(`
      SELECT status::text AS state FROM service_requests WHERE id=$1
    `,[f.request]);
    assert.equal(rows.rows[0].state,'PENDING');
  });
});

test('expired proof in long transaction denies completed cancellation ledger replay',async()=>{
  await withFixture(async(db,f)=>{
    const ledgerSecret=randomBytes(32),key='GuestCancel_2026_00000015';
    const replay=()=>cancelGuestRequestIdempotently(
      db,f.request,f.valid,1,key,secret,ledgerSecret);
    const done=await replay();
    assert.equal(done.version,2);
    await db.query(`
      UPDATE guest_capabilities
      SET expires_at=clock_timestamp()+interval '100 milliseconds'
      WHERE request_id=$1
    `,[f.request]);
    await db.query('SELECT pg_sleep(0.20)');
    await assert.rejects(replay(),(error:unknown)=>
      error instanceof GuestCancellationRejected&&error.reason==='unavailable');
    const events=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM cancellation_events
      WHERE request_id=$1
    `,[f.request]);
    assert.equal(events.rows[0].n,'1');
  });
});

test('stale expected version and duplicate cancellation cannot create extra events',async()=>{
  await withFixture(async(db,f)=>{
    await assert.rejects(cancelVerifiedGuestRequest(db,f.request,f.valid,2,secret),
      (e:unknown)=>e instanceof GuestCancellationRejected&&e.reason==='conflict');
    await cancelVerifiedGuestRequest(db,f.request,f.valid,1,secret);
    await assert.rejects(cancelVerifiedGuestRequest(db,f.request,f.valid,1,secret),
      (e:unknown)=>e instanceof GuestCancellationRejected&&e.reason==='conflict');
    const rows=await db.query<{n:string}>(
      'SELECT count(*)::text AS n FROM cancellation_events WHERE request_id=$1',[f.request]);
    assert.equal(rows.rows[0].n,'1');
  });
});
test('a notification persistence failure rolls back ALL cancellation writes',async()=>{
  await withFixture(async(db,f)=>{
    // Unique dedupe conflict is raised *after* cancellation and outbox writes.
    // A caller-owned transaction must roll back fully; emulate it with a savepoint.
    await db.query(`INSERT INTO domain_outbox_events
      (id,topic,subject_kind,subject_id,safe_payload)
      VALUES($1,'test.fixture','ServiceRequest',$2,'{}'::jsonb)`,
      [id(),f.request]);
    const topic=await db.query<{id:string}>(`
      SELECT id::text FROM domain_outbox_events
      WHERE subject_id=$1 AND topic='test.fixture'`,[f.request]);
    await db.query(`INSERT INTO notification_intents
      (id,domain_event_id,recipient_org_id,audience,channel,dedupe_key)
      VALUES($1,$2,$3,'COUNTERPARTY','IN_APP',$4)`,
      [id(),topic.rows[0].id,f.org,'cancel:counterparty:'+f.request]);
    await db.query('SAVEPOINT cancel_attempt');
    await assert.rejects(
      cancelVerifiedGuestRequest(db,f.request,f.valid,1,secret));
    await db.query('ROLLBACK TO SAVEPOINT cancel_attempt');
    const request=await db.query<{status:string;version:number}>(`
      SELECT status::text,version FROM service_requests WHERE id=$1
    `,[f.request]);
    assert.deepEqual(request.rows[0],{status:'PENDING',version:1});
    const events=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM cancellation_events WHERE request_id=$1
    `,[f.request]);
    assert.equal(events.rows[0].n,'0');
    const outbox=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM domain_outbox_events
      WHERE subject_id=$1 AND topic='service_request.cancelled'
    `,[f.request]);
    assert.equal(outbox.rows[0].n,'0');
  });
});

test('scheduled accepted request is blocked until calendar allocation cleanup is atomic',async()=>{
  await withFixture(async(db,f)=>{
    await db.query(`
      UPDATE service_requests SET status='ACCEPTED',version=2,
        accepted_at=now()-interval '1 hour',
        scheduled_start_at=now()+interval '2 hours',
        scheduled_end_at=now()+interval '3 hours',
        timezone='Asia/Almaty'
      WHERE id=$1
    `,[f.request]);
    await assert.rejects(cancelVerifiedGuestRequest(db,f.request,f.valid,2,secret),
      (e:unknown)=>e instanceof GuestCancellationRejected&&e.reason==='conflict');
    const result=await db.query<{status:string;version:number}>(`
      SELECT status::text,version FROM service_requests WHERE id=$1
    `,[f.request]);
    assert.deepEqual(result.rows[0],{status:'ACCEPTED',version:2});
    const count=await db.query<{n:string}>(`
      SELECT count(*)::text AS n FROM notification_intents
      WHERE dedupe_key LIKE $1
    `,['cancel:%:'+f.request]);
    assert.equal(count.rows[0].n,'0');
  });
});

test('Nest guest cancellation service delegates real PostgreSQL ledger within one client',async()=>{
  await withFixture(async(db,f)=>{
    const priorPepper=process.env.GUEST_REQUEST_HMAC_KEY;
    const priorLedger=process.env.GUEST_CANCEL_LEDGER_HMAC_KEY;
    const ledgerSecret=randomBytes(32);
    let transactions=0;
    const adapter={
      transaction:async<T>(work:(client:Client)=>Promise<T>):Promise<T>=>{
        transactions++;
        // Fixture owns BEGIN/ROLLBACK, just like DatabasePool owns the
        // transaction boundary in production; retain one leased DB client.
        return work(db);
      },
    } as unknown as DatabasePool;
    try{
      process.env.GUEST_REQUEST_HMAC_KEY=secret.toString('base64');
      process.env.GUEST_CANCEL_LEDGER_HMAC_KEY=ledgerSecret.toString('base64');
      const service=new GuestCancellationService(adapter);
      const key='GuestCancel_Service_2026_00000001';
      const first=await service.cancelIdempotently(f.request,f.valid,1,key);
      assert.deepEqual(first,{
        id:f.request,state:'cancelled_by_customer',version:2,
      });
      assert.deepEqual(
        await service.cancelIdempotently(f.request,f.valid,1,key),first);
      assert.equal(transactions,2);
      const counts=await db.query<{events:string;intents:string}>(`
        SELECT
          (SELECT count(*)::text FROM cancellation_events
           WHERE request_id=$1) AS events,
          (SELECT count(*)::text FROM notification_intents
           WHERE dedupe_key LIKE $2) AS intents
      `,[f.request,'cancel:%:'+f.request]);
      assert.deepEqual(counts.rows,[{events:'1',intents:'2'}]);
      await assert.rejects(
        service.cancelIdempotently(f.request,f.foreign,1,key),
        (error:unknown)=>error instanceof GuestCancellationRejected&&
          error.reason==='unavailable');
    }finally{
      if(priorPepper===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
      else process.env.GUEST_REQUEST_HMAC_KEY=priorPepper;
      if(priorLedger===undefined)delete process.env.GUEST_CANCEL_LEDGER_HMAC_KEY;
      else process.env.GUEST_CANCEL_LEDGER_HMAC_KEY=priorLedger;
    }
  });
});

test('guest cancellation preflight and PostgreSQL transaction compose without duplicate notices',async()=>{
  await withFixture(async(db,f)=>{
    const oldPepper=process.env.GUEST_REQUEST_HMAC_KEY;
    const oldLedger=process.env.GUEST_CANCEL_LEDGER_HMAC_KEY;
    let transactions=0;
    const database={
      transaction:async<T>(work:(client:Client)=>Promise<T>):Promise<T>=>{
        transactions++;
        return work(db);
      },
    } as unknown as DatabasePool;
    try{
      process.env.GUEST_REQUEST_HMAC_KEY=secret.toString('base64');
      process.env.GUEST_CANCEL_LEDGER_HMAC_KEY=randomBytes(32).toString('base64');
      const service=new GuestCancellationService(database);
      const csrf=randomBytes(32).toString('base64url');
      const transport={
        requestId:f.request,rawBody:'{"expectedVersion":1}',
        idempotencyHeader:'GuestCancel_BFF_2026_00000001',
        csrfHeader:csrf,sessionExpectedCsrf:csrf,
        expectedOrigin:'https://services.example.test',
        origin:'https://services.example.test',
        fetchSite:'same-origin',contentType:'application/json',
        requestProtocol:'https:',
      };
      for(const invalid of [
        {...transport,origin:'https://attacker.example.test'},
        {...transport,rawBody:'{"expectedVersion":1,"actor":"admin"}'},
        {...transport,csrfHeader:randomBytes(32).toString('base64url')},
      ]){
        await assert.rejects(
          async()=>service.cancelWithPreflight(invalid,f.valid));
      }
      assert.equal(transactions,0,'invalid HTTP preflight must not lease DB');
      const first=await service.cancelWithPreflight(transport,f.valid);
      assert.deepEqual(first,{
        id:f.request,state:'cancelled_by_customer',version:2,
      });
      assert.deepEqual(
        await service.cancelWithPreflight(transport,f.valid),first);
      assert.equal(transactions,2);
      const rows=await db.query<{events:string;intents:string}>(`
        SELECT
          (SELECT count(*)::text FROM cancellation_events
           WHERE request_id=$1) AS events,
          (SELECT count(*)::text FROM notification_intents
           WHERE dedupe_key LIKE $2) AS intents
      `,[f.request,'cancel:%:'+f.request]);
      assert.deepEqual(rows.rows,[{events:'1',intents:'2'}]);
    }finally{
      if(oldPepper===undefined)delete process.env.GUEST_REQUEST_HMAC_KEY;
      else process.env.GUEST_REQUEST_HMAC_KEY=oldPepper;
      if(oldLedger===undefined)delete process.env.GUEST_CANCEL_LEDGER_HMAC_KEY;
      else process.env.GUEST_CANCEL_LEDGER_HMAC_KEY=oldLedger;
    }
  });
});

test('guest cancel ledger atomically records one cancellation and replays same key',async()=>{
  await withFixture(async(db,f)=>{
    const ledgerSecret=randomBytes(32),key='GuestCancel_2026_00000001';
    const cancel=(version=1,k=key,proof=f.valid)=>
      cancelGuestRequestIdempotently(db,f.request,proof,version,k,
        secret,ledgerSecret);
    const first=await cancel();
    assert.deepEqual(first,{id:f.request,state:'cancelled_by_customer',version:2});
    const replay=await cancel();
    assert.deepEqual(replay,first);
    const ledger=await db.query<{
      actor_scope:string;method:string;route:string;key:string;
      state:string;request_hash:string;response_status:number;
      response_body:{id:string;version:number;state:string};
    }>(`
      SELECT actor_scope,method,route,key,state,request_hash,
        response_status,response_body
      FROM idempotency_records WHERE route=$1
    `,['/v1/requests/'+f.request+'/cancel']);
    assert.equal(ledger.rows.length,1);
    assert.match(ledger.rows[0].actor_scope,/^guest-cancel:[0-9a-f]{64}$/);
    assert.equal(ledger.rows[0].key,'guest-cancel-v1');
    assert.equal(ledger.rows[0].state,'COMPLETED');
    assert.equal(ledger.rows[0].method,'POST');
    assert.equal(ledger.rows[0].response_status,200);
    assert.deepEqual(ledger.rows[0].response_body,first);
    assert.doesNotMatch(JSON.stringify(ledger.rows),new RegExp(key));
    assert.doesNotMatch(JSON.stringify(ledger.rows),new RegExp(f.valid));
    await assert.rejects(cancel(2),
      (error:unknown)=>error instanceof GuestCancellationRejected&&
        error.reason==='conflict');
    await assert.rejects(cancel(1,'GuestCancel_2026_00000002'),
      GuestCancellationRejected);
    await assert.rejects(cancel(1,key,f.foreign),
      (error:unknown)=>error instanceof GuestCancellationRejected&&
        error.reason==='unavailable');
    const events=await db.query<{n:string}>(`
      SELECT count(*)::text n FROM cancellation_events
      WHERE request_id=$1
    `,[f.request]);
    assert.equal(events.rows[0].n,'1');
    const notices=await db.query<{n:string}>(`
      SELECT count(*)::text n FROM notification_intents
      WHERE dedupe_key LIKE $1
    `,['cancel:%:'+f.request]);
    assert.equal(notices.rows[0].n,'2');
    const outbox=await db.query<{n:string}>(`
      SELECT count(*)::text n FROM domain_outbox_events
      WHERE subject_id=$1 AND topic='service_request.cancelled'
    `,[f.request]);
    assert.equal(outbox.rows[0].n,'1');
  });
});
test('guest cancellation ledger replay rejects stale authoritative request version',async()=>{
  await withFixture(async(db,f)=>{
    const ledgerSecret=randomBytes(32),key='GuestCancel_2026_00000009';
    const replay=()=>cancelGuestRequestIdempotently(
      db,f.request,f.valid,1,key,secret,ledgerSecret);
    const done=await replay();
    assert.equal(done.version,2);
    assert.deepEqual(await replay(),done);
    // Even a previously completed record cannot attest to a later version.
    await db.query('UPDATE service_requests SET version=version+1 WHERE id=$1',
      [f.request]);
    await assert.rejects(replay(),(error:unknown)=>
      error instanceof GuestCancellationRejected&&error.reason==='conflict');
    const ledger=await db.query<{state:string}>(`
      SELECT state FROM idempotency_records
      WHERE route=$1
    `,['/v1/requests/'+f.request+'/cancel']);
    assert.deepEqual(ledger.rows,[{state:'COMPLETED'}]);
  });
});

test('guest cancellation replay rejects forged success version even if DB version matches',async()=>{
  await withFixture(async(db,f)=>{
    const ledgerSecret=randomBytes(32),key='GuestCancel_2026_00000010';
    const replay=()=>cancelGuestRequestIdempotently(
      db,f.request,f.valid,1,key,secret,ledgerSecret);
    const done=await replay();
    assert.equal(done.version,2);
    // An idempotency record cannot assert a transition larger than +1,
    // even if the authoritative request was separately advanced.
    await db.query('UPDATE service_requests SET version=3 WHERE id=$1',
      [f.request]);
    await db.query(`
      UPDATE idempotency_records
      SET response_body=$2::jsonb
      WHERE route=$1
    `,['/v1/requests/'+f.request+'/cancel',
      JSON.stringify({...done,version:3})]);
    await assert.rejects(replay(),(error:unknown)=>
      error instanceof GuestCancellationRejected&&error.reason==='conflict');
  });
});

test('guest cancellation replay rejects changed request status at same version',async()=>{
  await withFixture(async(db,f)=>{
    const ledgerSecret=randomBytes(32),key='GuestCancel_2026_00000011';
    const replay=()=>cancelGuestRequestIdempotently(
      db,f.request,f.valid,1,key,secret,ledgerSecret);
    const done=await replay();
    assert.equal(done.version,2);
    await db.query("UPDATE service_requests SET status='PENDING' WHERE id=$1",
      [f.request]);
    await assert.rejects(replay(),(error:unknown)=>
      error instanceof GuestCancellationRejected&&error.reason==='conflict');
  });
});

test('completed guest cancellation ledger rejects extended and array response bodies',async()=>{
  await withFixture(async(db,f)=>{
    const ledgerSecret=randomBytes(32),key='GuestCancel_2026_00000013';
    const replay=()=>cancelGuestRequestIdempotently(
      db,f.request,f.valid,1,key,secret,ledgerSecret);
    const done=await replay();
    assert.deepEqual(await replay(),done);
    for(const payload of [
      {...done,actor:'ADMIN'},
      [done],
      {id:done.id,state:done.state},
    ]){
      await db.query(`
        UPDATE idempotency_records SET response_body=$2::jsonb
        WHERE route=$1
      `,['/v1/requests/'+f.request+'/cancel',JSON.stringify(payload)]);
      await assert.rejects(replay(),(error:unknown)=>
        error instanceof GuestCancellationRejected&&error.reason==='conflict');
    }
    const events=await db.query<{n:string}>(`
      SELECT count(*)::text n FROM cancellation_events WHERE request_id=$1
    `,[f.request]);
    assert.equal(events.rows[0].n,'1');
  });
});

test('expired cancellation ledger never replays completed success',async()=>{
  await withFixture(async(db,f)=>{
    const ledgerSecret=randomBytes(32),key='GuestCancel_2026_00000014';
    const replay=()=>cancelGuestRequestIdempotently(
      db,f.request,f.valid,1,key,secret,ledgerSecret);
    const done=await replay();
    assert.equal(done.version,2);
    await db.query(`
      UPDATE idempotency_records
      SET created_at=clock_timestamp()-interval '2 days',
          expires_at=clock_timestamp()-interval '1 day'
      WHERE route=$1
    `,['/v1/requests/'+f.request+'/cancel']);
    await assert.rejects(replay(),(error:unknown)=>
      error instanceof GuestCancellationRejected&&error.reason==='conflict');
    const events=await db.query<{n:string}>(`
      SELECT count(*)::text n FROM cancellation_events WHERE request_id=$1
    `,[f.request]);
    assert.equal(events.rows[0].n,'1');
  });
});

test('failed guest cancellation ledger and state changes roll back together',async()=>{
  await withFixture(async(db,f)=>{
    const ledgerSecret=randomBytes(32),key='GuestCancel_2026_00000003';
    await db.query('SAVEPOINT idempotent_cancel');
    await assert.rejects(cancelGuestRequestIdempotently(
      db,f.request,f.valid,2,key,secret,ledgerSecret),
      GuestCancellationRejected);
    await db.query('ROLLBACK TO SAVEPOINT idempotent_cancel');
    const ledger=await db.query<{n:string}>(`
      SELECT count(*)::text n FROM idempotency_records
      WHERE route=$1
    `,['/v1/requests/'+f.request+'/cancel']);
    assert.equal(ledger.rows[0].n,'0');
    const request=await db.query<{status:string;version:number}>(`
      SELECT status::text,version FROM service_requests WHERE id=$1
    `,[f.request]);
    assert.deepEqual(request.rows[0],{status:'PENDING',version:1});
  });
});

test('completed guest cancellation replay requires a still-active verified proof',async()=>{
  await withFixture(async(db,f)=>{
    const ledgerSecret=randomBytes(32),key='GuestCancel_2026_00000004';
    const replay=()=>cancelGuestRequestIdempotently(
      db,f.request,f.valid,1,key,secret,ledgerSecret);
    const done=await replay();
    assert.equal(done.version,2);
    await db.query(`
      UPDATE guest_capabilities SET consumed_at=now()
      WHERE request_id=$1 AND scope='READ_CANCEL'
    `,[f.request]);
    await assert.rejects(replay(),
      (error:unknown)=>error instanceof GuestCancellationRejected&&
        error.reason==='unavailable');
    const stored=await db.query<{state:string;response_status:number}>(`
      SELECT state,response_status FROM idempotency_records
      WHERE route=$1
    `,['/v1/requests/'+f.request+'/cancel']);
    assert.deepEqual(stored.rows,[{state:'COMPLETED',response_status:200}]);
    const events=await db.query<{n:string}>(`
      SELECT count(*)::text n FROM cancellation_events
      WHERE request_id=$1
    `,[f.request]);
    assert.equal(events.rows[0].n,'1');
  });
});
test('completed cancellation ledger replay requires live verified guest contact',async()=>{
  await withFixture(async(db,f)=>{
    const ledgerSecret=randomBytes(32),key='GuestCancel_2026_00000012';
    const replay=()=>cancelGuestRequestIdempotently(
      db,f.request,f.valid,1,key,secret,ledgerSecret);
    assert.equal((await replay()).version,2);
    await db.query(`
      UPDATE guest_contacts SET expires_at=now()-interval '1 second'
      WHERE id=$1
    `,[f.guest]);
    await assert.rejects(replay(),(error:unknown)=>
      error instanceof GuestCancellationRejected&&error.reason==='unavailable');
    const ledger=await db.query<{state:string}>(`
      SELECT state FROM idempotency_records WHERE route=$1
    `,['/v1/requests/'+f.request+'/cancel']);
    assert.deepEqual(ledger.rows,[{state:'COMPLETED'}]);
  });
});

test('notification failure rolls back guest cancellation and ledger result together',async()=>{
  await withFixture(async(db,f)=>{
    const ledgerSecret=randomBytes(32),key='GuestCancel_2026_00000005';
    // A duplicate mandatory counterparty intent makes notification insert fail
    // after cancellation state/outbox have already been attempted.
    const priorEvent=id();
    await db.query(`
      INSERT INTO domain_outbox_events
        (id,topic,subject_kind,subject_id,safe_payload)
      VALUES($1,'test.cancellation_conflict','ServiceRequest',$2,'{}'::jsonb)
    `,[priorEvent,f.request]);
    await db.query(`
      INSERT INTO notification_intents
        (id,domain_event_id,recipient_org_id,audience,channel,dedupe_key)
      VALUES($1,$2,$3,'COUNTERPARTY','IN_APP',$4)
    `,[id(),priorEvent,f.org,'cancel:counterparty:'+f.request]);
    await db.query('SAVEPOINT ledger_attempt');
    await assert.rejects(cancelGuestRequestIdempotently(
      db,f.request,f.valid,1,key,secret,ledgerSecret));
    await db.query('ROLLBACK TO SAVEPOINT ledger_attempt');
    const request=await db.query<{status:string;version:number}>(`
      SELECT status::text,version FROM service_requests WHERE id=$1
    `,[f.request]);
    assert.deepEqual(request.rows[0],{status:'PENDING',version:1});
    const ledger=await db.query<{n:string}>(`
      SELECT count(*)::text n FROM idempotency_records WHERE route=$1
    `,['/v1/requests/'+f.request+'/cancel']);
    assert.equal(ledger.rows[0].n,'0');
    const events=await db.query<{n:string}>(`
      SELECT count(*)::text n FROM cancellation_events WHERE request_id=$1
    `,[f.request]);
    assert.equal(events.rows[0].n,'0');
    const outbox=await db.query<{n:string}>(`
      SELECT count(*)::text n FROM domain_outbox_events
      WHERE topic='service_request.cancelled' AND subject_id=$1
    `,[f.request]);
    assert.equal(outbox.rows[0].n,'0');
  });
});
