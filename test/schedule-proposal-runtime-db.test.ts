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
  try{
    const pepper=randomBytes(32);
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
    const proposalKey='schedule_proposal_key_12345';
    const proposed=await mutateScheduleProposal(db,{token:sellerAuth.token,requestId:request,
      action:'propose',expectedVersion:1,key:proposalKey,pepper,input});
    assert.equal(proposed.status,'proposed');
    assert.equal(proposed.request_version,2);
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

    const confirmKey='schedule_confirm_key_12345';
    const confirmed=await mutateScheduleProposal(db,{token:customerAuth.token,requestId:request,
      action:'confirm',proposalId:proposed.id,expectedVersion:2,key:confirmKey,pepper});
    assert.equal(confirmed.status,'confirmed');
    assert.equal(confirmed.request_version,3);
    const confirmedReplay=await mutateScheduleProposal(db,{token:customerAuth.token,requestId:request,
      action:'confirm',proposalId:proposed.id,expectedVersion:2,key:confirmKey,pepper});
    assert.equal(confirmedReplay.replayed,true);

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
    await db.query('ROLLBACK').catch(()=>{});await db.end();
  }
});
