import 'reflect-metadata';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {ScheduleProposalHttpController} from '../src/modules/requests/schedule-proposal-http.controller.js';
import {ScheduleProposalHttpService} from '../src/modules/requests/schedule-proposal-http.service.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {cancelAcceptedEarlyByCustomer} from '../src/modules/requests/accepted-early-cancellation.transaction.js';
import {mutateScheduleProposal,ScheduleProposalRejected} from '../src/modules/requests/schedule-proposal.transaction.js';

test('schedule proposal, seller penalty suspension and recipient confirmation are atomic and replayable',async()=>{
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();await db.query('BEGIN');
  const prior=process.env.ACCOUNT_SESSION_HMAC_KEY;
  let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
  try{
    const pepper=randomBytes(32);
    process.env.ACCOUNT_SESSION_HMAC_KEY=pepper.toString('base64');
    const sellerUser=randomUUID(),sellerPerson=randomUUID(),customerUser=randomUUID(),customerPerson=randomUUID();
    const org=randomUUID(),membership=randomUUID(),definition=randomUUID(),offer=randomUUID();
    const request=randomUUID(),sellerSession=randomUUID(),customerSession=randomUUID();
    const sellerAuth=issueSessionToken(pepper),customerAuth=issueSessionToken(pepper);
    await db.query('INSERT INTO users(id) VALUES($1),($2)',[sellerUser,customerUser]);
    await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2),($3,$4)',[
      sellerPerson,sellerUser,customerPerson,customerUser,
    ]);
    await db.query(`INSERT INTO organizations(id,owner_person_id,slug,name,status)
      VALUES($1,$2,$3,'Schedule seller','ACTIVE')`,[org,sellerPerson,'schedule-'+randomUUID()]);
    await db.query(`INSERT INTO organization_members(id,organization_id,user_id,role)
      VALUES($1,$2,$3,'ADMIN')`,[membership,org,sellerUser]);
    await db.query('INSERT INTO service_definitions(id,code,name) VALUES($1,$2,$3)',[
      definition,'schedule-'+randomUUID(),'Schedule test service',
    ]);
    await db.query(`INSERT INTO service_offers
      (id,definition_id,organization_id,title,status,delivery_mode,contacts)
      VALUES($1,$2,$3,'Offer','PUBLISHED','online','{}'::jsonb)`,[offer,definition,org]);
    const acceptedAt=new Date(Date.now()-60*60_000);
    const oldStart=new Date(Date.now()+24*60*60_000),oldEnd=new Date(oldStart.getTime()+60*60_000);
    const oldCutoff=new Date(Date.now()-60*60_000);
    await db.query(`INSERT INTO cancellation_policies(offer_id,free_cancel_before_min,revision)
      VALUES($1,120,7)`,[offer]);
    await db.query(`INSERT INTO service_requests
      (id,offer_id,customer_person_id,source_context,seller_organization_id,status,
       accepted_at,scheduled_start_at,scheduled_end_at,timezone)
      VALUES($1,$2,$3,'ORGANIZATION',$4,'ACCEPTED',$5,$6,$7,'Asia/Qyzylorda')`,[
      request,offer,customerPerson,org,acceptedAt,oldStart,oldEnd,
    ]);
    await db.query(`INSERT INTO cancellation_snapshots
      (request_id,policy_revision,scheduled_start_at,free_cancel_before_min,
       free_cancel_until,accepted_at,timezone)
      VALUES($1,6,$2,120,$3,$4,'Asia/Qyzylorda')`,[request,oldStart,oldCutoff,acceptedAt]);
    await db.query(`INSERT INTO sessions(id,user_id,token_hash,family_id,expires_at)
      VALUES($1,$2,$3,$4,now()+interval '1 day'),($5,$6,$7,$8,now()+interval '1 day')`,[
      sellerSession,sellerUser,sellerAuth.hash,randomUUID(),customerSession,customerUser,
      customerAuth.hash,randomUUID(),
    ]);

    // Keep the proposal in the future; fixed dates become invalid as CI ages.
    // Asia/Qyzylorda is UTC+05:00 for this test's scheduling window.
    const nextStart=new Date(Date.now()+7*24*60*60_000);
    nextStart.setUTCMinutes(0,0,0);
    const localStartAt=new Date(nextStart.getTime()+5*60*60_000)
      .toISOString().slice(0,19);
    const input={startAt:nextStart,endAt:new Date(nextStart.getTime()+60*60_000),
      timezone:'Asia/Qyzylorda',localStartAt,
      utcOffsetSeconds:18000};
    // Real Nest HTTP controller and service using the isolated PG fixture.
    const service=new ScheduleProposalHttpService({
      transaction:async<T>(work:(client:Client)=>Promise<T>):Promise<T>=>work(db),
    } as never);
    @Module({controllers:[ScheduleProposalHttpController],
      providers:[{provide:ScheduleProposalHttpService,useValue:service}]})
    class ScheduleHttpTestModule{}
    app=await NestFactory.create(ScheduleHttpTestModule,{logger:false});
    app.setGlobalPrefix('v1');
    await app.listen(0,'127.0.0.1');
    const url=(await app.getUrl())+'/v1/requests/'+request+'/schedule-proposals';
    const wire={start_at:input.startAt.toISOString(),end_at:input.endAt.toISOString(),
      timezone:input.timezone,local_start_at:input.localStartAt,utc_offset_seconds:input.utcOffsetSeconds};
    const send=(suffix:string,token:string|undefined,version:string,key:string,body?:unknown,
      extra:Record<string,string>={})=>fetch(url+suffix,{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),
      headers:{'If-Match':version,'Idempotency-Key':key,
        ...(token?{Authorization:'Bearer '+token}:{}),
        ...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    assert.equal((await send('',undefined,'"1"','http_anonymous_proposal',wire)).status,401);
    assert.equal((await send('',sellerAuth.token,'W/"1"','http_weak_version',wire)).status,400);
    assert.equal((await send('',sellerAuth.token,'"1"','http_mixed_credentials',wire,
      {'Guest-Capability':randomBytes(32).toString('base64url')})).status,401);
    assert.equal((await send('',sellerAuth.token,'"1"','http_bad_offset',
      {...wire,utc_offset_seconds:21600})).status,400);
    assert.equal((await db.query<{count:string}>(
      'SELECT count(*)::text AS count FROM schedule_proposals WHERE request_id=$1',[request]
    )).rows[0].count,'0');

    const readActive=(token?:string,target=request)=>fetch(
      (url.replace(request+'/schedule-proposals',target+'/schedule-proposals'))+'/active',{
      redirect:'manual',signal:AbortSignal.timeout(8000),
      headers:token?{Authorization:'Bearer '+token}:{},
    });
    const outsider=randomUUID(),outsiderAuth=issueSessionToken(pepper);
    await db.query('INSERT INTO users(id) VALUES($1)',[outsider]);
    await db.query(`INSERT INTO sessions(id,user_id,token_hash,family_id,expires_at)
      VALUES($1,$2,$3,$4,now()+interval '1 day')`,[randomUUID(),outsider,outsiderAuth.hash,randomUUID()]);
    assert.equal((await readActive()).status,401);
    assert.equal((await readActive(outsiderAuth.token)).status,404);
    assert.equal((await readActive(customerAuth.token,randomUUID())).status,404);
    const empty=await readActive(customerAuth.token);
    assert.equal(empty.status,200);
    assert.match(empty.headers.get('cache-control')??'',/no-store/);
    assert.deepEqual(await empty.json(),{request_id:request,request_version:1,actor:'customer',can_propose:true,proposal:null});

    const proposalKey='schedule_proposal_key_12345';
    const proposedHttp=await send('',sellerAuth.token,'"1"',proposalKey,wire);
    assert.equal(proposedHttp.status,201);
    assert.match(proposedHttp.headers.get('cache-control')??'',/no-store/);
    const proposed=await proposedHttp.json() as Awaited<ReturnType<typeof mutateScheduleProposal>>;
    assert.equal(proposed.replayed,false);
    assert.equal(proposed.status,'proposed');
    assert.equal(proposed.request_version,2);
    for(const [token,actor,canResolve] of [
      [customerAuth.token,'customer',true],[sellerAuth.token,'seller',false],
    ] as const){
      const view=await readActive(token);
      assert.equal(view.status,200);
      assert.deepEqual(await view.json(),{request_id:request,request_version:2,actor,can_propose:true,
        proposal:{id:proposed.id,revision:1,initiator:'seller',start_at:wire.start_at,end_at:wire.end_at,
          timezone:wire.timezone,can_resolve:canResolve}});
    }
    assert.equal((await readActive(outsiderAuth.token)).status,404);
    const replay=await mutateScheduleProposal(db,{token:sellerAuth.token,requestId:request,
      action:'propose',expectedVersion:1,key:proposalKey,pepper,input});
    assert.equal(replay.replayed,true);
    await assert.rejects(mutateScheduleProposal(db,{token:sellerAuth.token,requestId:request,
      action:'propose',expectedVersion:1,key:proposalKey,pepper,
      input:{...input,endAt:new Date(input.endAt.getTime()+60_000)}}),
      (error:unknown)=>error instanceof ScheduleProposalRejected&&error.reason==='conflict');

    const suspended=await db.query<{customer_penalty_suspended:boolean;version:number}>(`
      SELECT customer_penalty_suspended,version FROM service_requests WHERE id=$1::uuid`,[request]);
    assert.deepEqual(suspended.rows[0],{customer_penalty_suspended:true,version:2});

    await db.query('SAVEPOINT schedule_cancel_probe');
    const cancelledDuringReschedule=await cancelAcceptedEarlyByCustomer(db,request,customerPerson,2);
    assert.equal(cancelledDuringReschedule.state,'cancelled_by_customer');
    const noPenalty=await db.query<{count:string}>(`
      SELECT count(*)::text AS count FROM reliability_events WHERE request_id=$1::uuid`,[request]);
    assert.equal(noPenalty.rows[0].count,'0');
    await db.query('ROLLBACK TO SAVEPOINT schedule_cancel_probe');

    // The initiator cannot resolve their own proposal, even with a valid
    // session and current request version. Denial must leave no durable effects.
    for(const action of ['confirm','decline'] as const){
      await assert.rejects(mutateScheduleProposal(db,{token:sellerAuth.token,requestId:request,
        action,proposalId:proposed.id,expectedVersion:2,key:'self_resolution_'+action,pepper}),
        (error:unknown)=>error instanceof ScheduleProposalRejected&&error.reason==='conflict');
    }
    const deniedState=await db.query(`
      SELECT r.version,r.customer_penalty_suspended,p.status::text AS proposal_status
      FROM service_requests r JOIN schedule_proposals p ON p.request_id=r.id
      WHERE r.id=$1::uuid AND p.id=$2::uuid`,[request,proposed.id]);
    assert.deepEqual(deniedState.rows,[{version:2,customer_penalty_suspended:true,proposal_status:'PROPOSED'}]);
    const deniedEffects=await db.query(`
      SELECT
        (SELECT count(*)::int FROM cancellation_snapshot_revisions WHERE request_id=$1::uuid) AS revisions,
        (SELECT count(*)::int FROM domain_outbox_events WHERE subject_id=$1::uuid
          AND topic IN ('service_request.schedule_confirmed','service_request.schedule_declined')) AS outbox,
        (SELECT count(*)::int FROM idempotency_records WHERE actor_scope=$2
          AND key IN ('self_resolution_confirm','self_resolution_decline')) AS ledger
    `,[request,'user:'+sellerUser]);
    assert.deepEqual(deniedEffects.rows,[{revisions:0,outbox:0,ledger:0}]);

    // The legitimate recipient still needs the current request version.
    for(const action of ['confirm','decline'] as const){
      await assert.rejects(mutateScheduleProposal(db,{token:customerAuth.token,requestId:request,
        action,proposalId:proposed.id,expectedVersion:1,key:'stale_resolution_'+action,pepper}),
        (error:unknown)=>error instanceof ScheduleProposalRejected&&error.reason==='conflict');
    }
    assert.deepEqual((await db.query(`
      SELECT r.version,r.customer_penalty_suspended,p.status::text AS proposal_status
      FROM service_requests r JOIN schedule_proposals p ON p.request_id=r.id
      WHERE r.id=$1::uuid AND p.id=$2::uuid`,[request,proposed.id])).rows,
      deniedState.rows);
    const staleLedger=await db.query<{count:string}>(`
      SELECT count(*)::text AS count FROM idempotency_records WHERE actor_scope=$1
      AND key IN ('stale_resolution_confirm','stale_resolution_decline')
    `,['user:'+customerUser]);
    assert.equal(staleLedger.rows[0].count,'0');

    const confirmKey='schedule_confirm_key_12345';
    const confirmPath='/'+proposed.id+'/confirm';
    assert.equal((await send(confirmPath,sellerAuth.token,'"2"','http_self_confirm')).status,409);
    assert.equal((await send(confirmPath,customerAuth.token,'"1"','http_stale_confirm')).status,409);
    const confirmedHttp=await send(confirmPath,customerAuth.token,'"2"',confirmKey);
    assert.equal(confirmedHttp.status,200);
    assert.match(confirmedHttp.headers.get('cache-control')??'',/no-store/);
    const confirmed=await confirmedHttp.json() as Awaited<ReturnType<typeof mutateScheduleProposal>>;
    const httpReplay=await send(confirmPath,customerAuth.token,'"2"',confirmKey);
    assert.equal(httpReplay.status,200);
    assert.deepEqual(await httpReplay.json(),{...confirmed,replayed:true});
    assert.equal(confirmed.status,'confirmed');
    assert.equal(confirmed.request_version,3);
    const resolved=await readActive(customerAuth.token);
    assert.equal(resolved.status,200);
    assert.deepEqual(await resolved.json(),{request_id:request,request_version:3,actor:'customer',can_propose:true,proposal:null});
    const confirmedReplay=await mutateScheduleProposal(db,{token:customerAuth.token,requestId:request,
      action:'confirm',proposalId:proposed.id,expectedVersion:2,key:confirmKey,pepper});
    assert.equal(confirmedReplay.replayed,true);

    // A new key cannot turn a completed proposal into a second confirmation.
    for(const expectedVersion of [2,3]){
      await assert.rejects(mutateScheduleProposal(db,{token:customerAuth.token,requestId:request,
        action:'confirm',proposalId:proposed.id,expectedVersion,
        key:'duplicate_confirmation_'+expectedVersion,pepper}),
        (error:unknown)=>error instanceof ScheduleProposalRejected&&error.reason==='conflict');
    }
    const duplicateLedger=await db.query<{count:string}>(`
      SELECT count(*)::text AS count FROM idempotency_records WHERE actor_scope=$1
      AND key IN ('duplicate_confirmation_2','duplicate_confirmation_3')
    `,['user:'+customerUser]);
    assert.equal(duplicateLedger.rows[0].count,'0');


    const state=await db.query<{version:number;customer_penalty_suspended:boolean;
      accepted_at:Date;scheduled_start_at:Date}>(`
      SELECT version,customer_penalty_suspended,accepted_at,scheduled_start_at
      FROM service_requests WHERE id=$1::uuid`,[request]);
    assert.equal(state.rows[0].version,3);
    assert.equal(state.rows[0].customer_penalty_suspended,false);
    assert.equal(state.rows[0].scheduled_start_at.toISOString(),nextStart.toISOString());
    const snapshot=await db.query<{policy_revision:number;accepted_at:Date;free_cancel_until:Date}>(`
      SELECT policy_revision,accepted_at,free_cancel_until FROM cancellation_snapshots
      WHERE request_id=$1::uuid`,[request]);
    assert.equal(snapshot.rows[0].policy_revision,7);
    assert.equal(snapshot.rows[0].accepted_at.toISOString(),state.rows[0].accepted_at.toISOString());
    const history=await db.query<{schedule_revision:number}>(`
      SELECT schedule_revision FROM cancellation_snapshot_revisions WHERE request_id=$1::uuid`,[request]);
    assert.deepEqual(history.rows,[{schedule_revision:1}]);
    const notices=await db.query<{count:string}>(`
      SELECT count(*)::text AS count FROM notification_intents
      WHERE domain_event_id IN (SELECT id FROM domain_outbox_events WHERE subject_id=$1::uuid)`,[request]);
    assert.equal(notices.rows[0].count,'3');
  }finally{
    if(app)await app.close();
    if(prior===undefined)delete process.env.ACCOUNT_SESSION_HMAC_KEY;
    else process.env.ACCOUNT_SESSION_HMAC_KEY=prior;
    await db.query('ROLLBACK').catch(()=>{});await db.end();
  }
});
