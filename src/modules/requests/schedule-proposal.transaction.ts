import {createHmac, randomUUID} from 'node:crypto';
import {UnauthorizedException} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {resolveActiveUserSession} from '../identity/session-proof.js';
import {resolveSellerDecisionAuthority} from './seller-authority.js';
import type {ScheduleProposalInput} from './schedule-proposal.contract.js';
import {hashGuestCapability} from '../guest-requests/guest-request.security.js';

export type ScheduleProposalCommandResult = {
  id:string;request_id:string;revision:number;status:'proposed'|'declined'|'confirmed';
  initiator:'customer'|'seller';start_at:string;end_at:string;timezone:string;
  request_version:number;replayed:boolean;confirmed_at?:string;cancellation_deadline_at?:string;
};
type Actor='CUSTOMER'|'SELLER';
export type ScheduleProposalAction='propose'|'decline'|'confirm';
type RequestRow={
  id:string;offer_id:string;status:string;version:number;schedule_reconciliation_required:boolean;
  customer_person_id:string|null;
  guest_contact_id:string|null;seller_professional_id:string|null;
  seller_organization_id:string|null;performer_professional_id:string|null;
};
type StoredRecord={request_hash:string;state:string;response_body:unknown;expires_at:Date};
type ProposalRow={
  id:string;revision:number;status:string;initiator:string;
  proposed_start_at:Date;proposed_end_at:Date;timezone:string;
};

export class ScheduleProposalRejected extends Error {
  constructor(readonly reason:'not_found'|'forbidden'|'conflict'){super(reason);}
}

/** Account callers use session proofs; guests require a request-bound OTP proof. */
export async function mutateScheduleProposal(
  client:Pick<PoolClient,'query'>,
  args:{token?:string;guestCapability?:string;requestId:string;action:ScheduleProposalAction;
    expectedVersion:number;key:string;pepper:Buffer;guestPepper?:Buffer;
    input?:ScheduleProposalInput;proposalId?:string},
):Promise<ScheduleProposalCommandResult>{
  const session=args.token?await resolveActiveUserSession(client,args.token,args.pepper):null;
  if(args.token&&!session)throw new UnauthorizedException('Authentication required');
  if(!session&&!args.guestCapability)throw new UnauthorizedException('Authentication required');

  const locked=await client.query<RequestRow>(`
    SELECT id::text,offer_id::text,status::text,version,schedule_reconciliation_required,
           customer_person_id::text,
           guest_contact_id::text,seller_professional_id::text,
           seller_organization_id::text,performer_professional_id::text
    FROM service_requests WHERE id=$1::uuid FOR UPDATE
  `,[args.requestId]);
  const request=locked.rows[0];
  if(!request)throw new ScheduleProposalRejected('not_found');
  let guestContactId:string|null=null;
  let guestCapabilityHash:string|null=null;
  if(!session&&args.guestCapability){
    let hash:string;
    try{
      if(!args.guestPepper)throw new Error('guest_key_unavailable');
      hash=hashGuestCapability('MANAGE_SCHEDULE',args.guestCapability,args.guestPepper);
    }catch{throw new ScheduleProposalRejected('forbidden');}
    guestCapabilityHash=hash;
    const proof=await client.query<{guest_contact_id:string}>(`
      SELECT cap.guest_contact_id::text
      FROM guest_capabilities cap JOIN service_requests r
        ON r.id=cap.request_id AND r.guest_contact_id=cap.guest_contact_id
      WHERE cap.request_id=$1::uuid AND cap.token_hash=$2 AND cap.scope='MANAGE_SCHEDULE'
        AND cap.consumed_at IS NULL AND cap.expires_at>now()
      FOR SHARE OF cap,r
    `,[args.requestId,hash]);
    guestContactId=proof.rows[0]?.guest_contact_id??null;
    if(!guestContactId)throw new ScheduleProposalRejected('forbidden');
  }
  const actor=session
    ?await resolveActor(client,session.userId,args.requestId,request)
    :request.guest_contact_id===guestContactId?'CUSTOMER':null;
  if(!actor)throw new ScheduleProposalRejected('forbidden');

  const route=args.action==='propose'
    ? `/requests/${args.requestId}/schedule-proposals`
    : `/requests/${args.requestId}/schedule-proposals/${args.proposalId}/${args.action}`;
  const actorScope=session?`user:${session.userId}`:`guest:${guestCapabilityHash}`;
  const requestHash=createHmac('sha256',args.pepper)
    .update('schedule-proposal:v1\0')
    .update(JSON.stringify([args.action,args.requestId,args.proposalId??null,args.expectedVersion,args.input??null]))
    .digest('hex');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[
    actorScope,route+':'+args.key,
  ]);
  const saved=await client.query<StoredRecord>(`
    SELECT request_hash,state,response_body,expires_at FROM idempotency_records
    WHERE actor_scope=$1 AND method='POST' AND route=$2 AND key=$3 FOR UPDATE
  `,[actorScope,route,args.key]);
  const previous=saved.rows[0];
  if(previous){
    if(previous.request_hash!==requestHash||previous.state!=='COMPLETED'||
       !(previous.expires_at instanceof Date)||
       !Number.isFinite(previous.expires_at.getTime())||
       previous.expires_at.getTime()<=Date.now())throw new ScheduleProposalRejected('conflict');
    return readStoredResult(previous.response_body,args.requestId,args.action,args.expectedVersion);
  }

  if(request.status!=='ACCEPTED'||request.version!==args.expectedVersion||request.schedule_reconciliation_required){
    throw new ScheduleProposalRejected('conflict');
  }
  if(request.guest_contact_id&&!guestContactId&&actor==='CUSTOMER'){
    throw new ScheduleProposalRejected('forbidden');
  }

  const actorId=session?.userId??guestContactId!;
  const result=args.action==='propose'
    ? await propose(client,request,actor,actorId,args.input!)
    : args.action==='decline'
      ? await decline(client,request,actor,actorId,args.proposalId!)
      : await confirm(client,request,actor,actorId,args.proposalId!);
  const output={...result,replayed:false};
  await client.query(`
    INSERT INTO idempotency_records
      (id,actor_scope,method,route,key,request_hash,state,response_status,response_body,expires_at)
    VALUES($1::uuid,$2,'POST',$3,$4,$5,'COMPLETED',200,$6::jsonb,now()+interval '24 hours')
  `,[randomUUID(),actorScope,route,args.key,requestHash,JSON.stringify(output)]);
  return output;
}

async function resolveActor(
  db:Pick<PoolClient,'query'>,userId:string,requestId:string,request:RequestRow,
):Promise<Actor|null>{
  if(request.customer_person_id){
    const customer=await db.query<{allowed:boolean}>(`
      SELECT true AS allowed FROM persons p JOIN users u ON u.id=p.user_id
      WHERE p.id=$1::uuid AND u.id=$2::uuid AND u.status='ACTIVE'
      FOR SHARE OF p,u
    `,[request.customer_person_id,userId]);
    if(customer.rows[0]?.allowed)return 'CUSTOMER';
  }
  const seller=await resolveSellerDecisionAuthority(db,userId,requestId);
  if(seller.authorized)return 'SELLER';
  return null;
}

async function propose(
  db:Pick<PoolClient,'query'>,request:RequestRow,actor:Actor,actorUserId:string,input:ScheduleProposalInput,
):Promise<Omit<ScheduleProposalCommandResult,'replayed'>>{
  if(!input)throw new ScheduleProposalRejected('conflict');
  const active=await db.query<ProposalRow>(`
    SELECT id::text,revision,status::text,initiator::text,
           proposed_start_at,proposed_end_at,timezone
    FROM schedule_proposals WHERE request_id=$1::uuid AND status='PROPOSED'
    FOR UPDATE
  `,[request.id]);
  if(active.rows[0]){
    await db.query(`
      UPDATE schedule_proposals SET status='SUPERSEDED',resolved_at=now(),resolved_by=$2::"ScheduleProposalActor"
      WHERE id=$1::uuid AND status='PROPOSED'
    `,[active.rows[0].id,actor]);
  }
  const revision=await db.query<{next_revision:number}>(`
    SELECT COALESCE(MAX(revision),0)+1 AS next_revision FROM schedule_proposals WHERE request_id=$1::uuid
  `,[request.id]);
  const proposalId=randomUUID();
  await db.query(`
    INSERT INTO schedule_proposals
      (id,request_id,revision,status,initiator,proposed_start_at,proposed_end_at,
       timezone,local_start_at,utc_offset_seconds)
    VALUES($1::uuid,$2::uuid,$3,'PROPOSED',$4::"ScheduleProposalActor",$5,$6,$7,$8,$9)
  `,[proposalId,request.id,revision.rows[0].next_revision,actor,input.startAt,input.endAt,
    input.timezone,input.localStartAt,input.utcOffsetSeconds]);

  if(actor==='SELLER'){
    await db.query(`
      UPDATE service_requests SET customer_penalty_suspended=true
      WHERE id=$1::uuid AND EXISTS(SELECT 1 FROM cancellation_snapshots WHERE request_id=$1::uuid)
    `,[request.id]);
  }
  await db.query('UPDATE service_requests SET version=version+1 WHERE id=$1::uuid AND version=$2',[
    request.id,request.version,
  ]);
  await writeScheduleEvent(db,request.id,'SCHEDULE_PROPOSED',proposalId,actor,actorUserId);
  const eventId=await writeOutbox(db,request.id,'service_request.schedule_proposed',{
    proposal_id:proposalId,revision:revision.rows[0].next_revision,
  });
  await notifyOtherSide(db,request,actor,eventId,`schedule-proposed:${request.id}:${revision.rows[0].next_revision}`);
  return {
    id:proposalId,request_id:request.id,revision:revision.rows[0].next_revision,
    status:'proposed',initiator:actor.toLowerCase() as 'customer'|'seller',
    start_at:input.startAt.toISOString(),end_at:input.endAt.toISOString(),
    timezone:input.timezone,request_version:request.version+1,
  };
}

async function decline(
  db:Pick<PoolClient,'query'>,request:RequestRow,actor:Actor,actorUserId:string,proposalId:string,
):Promise<Omit<ScheduleProposalCommandResult,'replayed'>>{
  const selected=await db.query<ProposalRow>(`
    SELECT id::text,revision,status::text,initiator::text,
           proposed_start_at,proposed_end_at,timezone
    FROM schedule_proposals WHERE id=$1::uuid AND request_id=$2::uuid FOR UPDATE
  `,[proposalId,request.id]);
  const proposal=selected.rows[0];
  if(!proposal)throw new ScheduleProposalRejected('not_found');
  if(proposal.status!=='PROPOSED'||proposal.initiator===actor){
    throw new ScheduleProposalRejected('conflict');
  }
  await db.query(`
    UPDATE schedule_proposals SET status='DECLINED',resolved_at=now(),resolved_by=$2::"ScheduleProposalActor"
    WHERE id=$1::uuid AND status='PROPOSED'
  `,[proposal.id,actor]);
  await db.query('UPDATE service_requests SET version=version+1 WHERE id=$1::uuid AND version=$2',[
    request.id,request.version,
  ]);
  await writeScheduleEvent(db,request.id,'SCHEDULE_DECLINED',proposal.id,actor,actorUserId);
  const eventId=await writeOutbox(db,request.id,'service_request.schedule_declined',{
    proposal_id:proposal.id,revision:proposal.revision,
  });
  await notifyOtherSide(db,request,actor,eventId,`schedule-declined:${proposal.id}`);
  return {
    id:proposal.id,request_id:request.id,revision:proposal.revision,
    status:'declined',initiator:proposal.initiator.toLowerCase() as 'customer'|'seller',
    start_at:proposal.proposed_start_at.toISOString(),end_at:proposal.proposed_end_at.toISOString(),
    timezone:proposal.timezone,request_version:request.version+1,
  };
}

async function confirm(
  db:Pick<PoolClient,'query'>,request:RequestRow,actor:Actor,actorUserId:string,proposalId:string,
):Promise<Omit<ScheduleProposalCommandResult,'replayed'>>{
  const selected=await db.query<ProposalRow>(`
    SELECT id::text,revision,status::text,initiator::text,
           proposed_start_at,proposed_end_at,timezone
    FROM schedule_proposals WHERE id=$1::uuid AND request_id=$2::uuid FOR UPDATE
  `,[proposalId,request.id]);
  const proposal=selected.rows[0];
  if(!proposal)throw new ScheduleProposalRejected('not_found');
  if(proposal.status!=='PROPOSED'||proposal.initiator===actor){
    throw new ScheduleProposalRejected('conflict');
  }
  const clock=await db.query<{agreed_at:Date}>(`SELECT now() AS agreed_at`);
  const agreedAt=clock.rows[0]?.agreed_at;
  if(!(agreedAt instanceof Date)||!Number.isFinite(agreedAt.getTime())){
    throw new ScheduleProposalRejected('conflict');
  }
  if(!(proposal.proposed_start_at instanceof Date)||
     !(proposal.proposed_end_at instanceof Date)){
    throw new ScheduleProposalRejected('conflict');
  }
  const startMillis=proposal.proposed_start_at.getTime();
  const endMillis=proposal.proposed_end_at.getTime();
  if(!Number.isFinite(startMillis)||!Number.isFinite(endMillis)||
     startMillis<=agreedAt.getTime()||endMillis<=startMillis){
    throw new ScheduleProposalRejected('conflict');
  }
  const terms=await db.query<{performer_id:string|null;availability:string}>(`
    SELECT r.performer_professional_id::text AS performer_id,
           offer.availability::text AS availability
    FROM service_requests r JOIN service_offers offer ON offer.id=r.offer_id
    WHERE r.id=$1::uuid
    FOR SHARE OF offer
  `,[request.id]);
  const policy=terms.rows[0];
  if(!policy)throw new ScheduleProposalRejected('conflict');
  const cancellationPolicy=await db.query<{revision:number;free_cancel_before_min:number}>(`
    SELECT revision,free_cancel_before_min FROM cancellation_policies WHERE offer_id=$1::uuid FOR SHARE
  `,[request.offer_id]);
  const freeCancelBeforeMin=cancellationPolicy.rows[0]?.free_cancel_before_min??120;
  const policyRevision=cancellationPolicy.rows[0]?.revision??1;
  const startAt=proposal.proposed_start_at;
  const rawDeadline=startAt.getTime()-freeCancelBeforeMin*60_000;
  const freeCancelUntil=new Date(rawDeadline<=agreedAt.getTime()
    ? Math.min(startAt.getTime(),Math.max(rawDeadline,agreedAt.getTime()+15*60_000))
    : rawDeadline);

  await reserveKnownCalendarBlock(db,request,policy.performer_id,policy.availability,startAt,proposal.proposed_end_at);
  await db.query(`
    INSERT INTO cancellation_snapshot_revisions
      (id,request_id,schedule_revision,policy_revision,scheduled_start_at,
       free_cancel_before_min,free_cancel_until,agreed_at,timezone,local_start_at,
       utc_offset_seconds,tzdb_version)
    SELECT $1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,local_start_at,utc_offset_seconds,tzdb_version
    FROM schedule_proposals WHERE id=$10::uuid
  `,[randomUUID(),request.id,proposal.revision,policyRevision,startAt,
    freeCancelBeforeMin,freeCancelUntil,agreedAt,proposal.timezone,proposal.id]);
  await db.query(`
    INSERT INTO cancellation_snapshots
      (request_id,policy_revision,scheduled_start_at,free_cancel_before_min,
       free_cancel_until,accepted_at,timezone)
    VALUES($1::uuid,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(request_id) DO UPDATE SET policy_revision=EXCLUDED.policy_revision,
      scheduled_start_at=EXCLUDED.scheduled_start_at,
      free_cancel_before_min=EXCLUDED.free_cancel_before_min,
      free_cancel_until=EXCLUDED.free_cancel_until,
      accepted_at=EXCLUDED.accepted_at,timezone=EXCLUDED.timezone
  `,[request.id,policyRevision,startAt,freeCancelBeforeMin,freeCancelUntil,agreedAt,proposal.timezone]);
  const transitioned=await db.query<{version:number}>(`
    UPDATE service_requests SET scheduled_start_at=$3,scheduled_end_at=$4,timezone=$5,accepted_at=$6,
      customer_penalty_suspended=false,version=version+1
    WHERE id=$1::uuid AND status='ACCEPTED' AND version=$2
    RETURNING version
  `,[request.id,request.version,startAt,proposal.proposed_end_at,proposal.timezone,agreedAt]);
  if(!transitioned.rows[0])throw new ScheduleProposalRejected('conflict');
  await db.query(`
    UPDATE schedule_proposals SET status='CONFIRMED',resolved_at=$2,
      resolved_by=$3::"ScheduleProposalActor"
    WHERE id=$1::uuid AND status='PROPOSED'
  `,[proposal.id,agreedAt,actor]);
  await writeScheduleEvent(db,request.id,'SCHEDULE_CONFIRMED',proposal.id,actor,actorUserId);
  const eventId=await writeOutbox(db,request.id,'service_request.schedule_confirmed',{
    proposal_id:proposal.id,revision:proposal.revision,
  });
  await notifyOtherSide(db,request,actor,eventId,`schedule-confirmed:${proposal.id}:other`);
  await notifyOtherSide(db,request,actor==='SELLER'?'CUSTOMER':'SELLER',eventId,
    `schedule-confirmed:${proposal.id}:actor`);
  return {
    id:proposal.id,request_id:request.id,revision:proposal.revision,status:'confirmed',
    initiator:proposal.initiator.toLowerCase() as 'customer'|'seller',
    start_at:startAt.toISOString(),end_at:proposal.proposed_end_at.toISOString(),
    timezone:proposal.timezone,request_version:transitioned.rows[0].version,
    confirmed_at:agreedAt.toISOString(),cancellation_deadline_at:freeCancelUntil.toISOString(),
  };
}

async function reserveKnownCalendarBlock(
  db:Pick<PoolClient,'query'>,request:RequestRow,performerId:string|null,availability:string,
  startAt:Date,endAt:Date,
):Promise<void>{
  const current=await db.query<{id:string}>(`
    SELECT id::text FROM busy_blocks WHERE request_id=$1::uuid FOR UPDATE
  `,[request.id]);
  if(!performerId){
    if(current.rows[0])throw new ScheduleProposalRejected('conflict');
    return;
  }
  const context=request.seller_organization_id?'ORGANIZATION':'PERSONAL';
  const organizationId=request.seller_organization_id;
  if(organizationId){
    const assignment=await db.query<{accepted:boolean}>(`
      SELECT true AS accepted FROM service_assignments
      WHERE offer_id=$1::uuid AND professional_id=$2::uuid AND status='ACCEPTED'
      FOR SHARE
    `,[request.offer_id,performerId]);
    if(!assignment.rows[0])throw new ScheduleProposalRejected('conflict');
  }
  const calendar=await db.query<{enabled:boolean}>(`
    SELECT true AS enabled FROM availability_allocations
    WHERE professional_id=$1::uuid AND context=$2::"WorkContext"
      AND ((context='PERSONAL' AND organization_id IS NULL AND master_approved=true)
        OR (context='ORGANIZATION' AND organization_id=$3::uuid
            AND master_approved=true AND company_approved=true))
    LIMIT 1
    FOR SHARE
  `,[performerId,context,organizationId]);
  const shouldReserve=Boolean(calendar.rows[0])&&availability!=='HIDDEN';
  if(!shouldReserve&&!current.rows[0])return;
  try{
    if(current.rows[0]){
      await db.query(`
        UPDATE busy_blocks SET professional_id=$2::uuid,organization_id=$3::uuid,
          context=$4::"WorkContext",start_at=$5,end_at=$6
        WHERE id=$1::uuid
      `,[current.rows[0].id,performerId,organizationId,context,startAt,endAt]);
    }else{
      await db.query(`
        INSERT INTO busy_blocks
          (id,professional_id,request_id,organization_id,start_at,end_at,context,private_reason)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::"WorkContext",'REQUEST_CONFIRMED')
      `,[randomUUID(),performerId,request.id,organizationId,startAt,endAt,context]);
    }
  }catch(error){
    if(error&&typeof error==='object'&&'code' in error&&(error as {code?:unknown}).code==='23P01'){
      throw new ScheduleProposalRejected('conflict');
    }
    throw error;
  }
}

async function writeScheduleEvent(
  db:Pick<PoolClient,'query'>,requestId:string,kind:string,proposalId:string,actor:Actor,actorUserId:string,
):Promise<void>{
  await db.query(`
    INSERT INTO service_request_events(id,request_id,kind,actor_id,detail)
    VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5::jsonb)
  `,[randomUUID(),requestId,kind,actorUserId,JSON.stringify({proposal_id:proposalId,actor})]);
}

async function writeOutbox(
  db:Pick<PoolClient,'query'>,requestId:string,topic:string,payload:Record<string,unknown>,
):Promise<string>{
  const id=randomUUID();
  await db.query(`
    INSERT INTO domain_outbox_events(id,topic,subject_kind,subject_id,safe_payload)
    VALUES($1::uuid,$2,'ServiceRequest',$3::uuid,$4::jsonb)
  `,[id,topic,requestId,JSON.stringify(payload)]);
  return id;
}

async function notifyOtherSide(
  db:Pick<PoolClient,'query'>,request:RequestRow,actor:Actor,eventId:string,dedupeKey:string,
):Promise<void>{
  if(actor==='SELLER'){
    if(request.customer_person_id){
      await db.query(`
        INSERT INTO notification_intents
          (id,domain_event_id,recipient_person_id,audience,channel,dedupe_key)
        VALUES($1::uuid,$2::uuid,$3::uuid,'CLIENT','IN_APP',$4)
      `,[randomUUID(),eventId,request.customer_person_id,dedupeKey]);
    }else if(request.guest_contact_id){
      const contact=await db.query<{channel:string}>(`
        SELECT channel FROM guest_contacts
        WHERE id=$1::uuid AND verified_at IS NOT NULL AND expires_at>now()
        FOR SHARE
      `,[request.guest_contact_id]);
      const channel=contact.rows[0]?.channel;
      if(channel!=='email'&&channel!=='sms')throw new ScheduleProposalRejected('forbidden');
      await db.query(`
        INSERT INTO notification_intents
          (id,domain_event_id,guest_contact_id,audience,channel,dedupe_key)
        VALUES($1::uuid,$2::uuid,$3::uuid,'CLIENT',$4,$5)
      `,[randomUUID(),eventId,request.guest_contact_id,channel.toUpperCase(),dedupeKey]);
    }else throw new ScheduleProposalRejected('forbidden');
    return;
  }
  const recipient=await db.query<{professional_person_id:string|null;organization_id:string|null}>(`
    SELECT CASE WHEN r.seller_professional_id IS NOT NULL THEN p.person_id::text END AS professional_person_id,
           r.seller_organization_id::text AS organization_id
    FROM service_requests r
    LEFT JOIN professional_profiles p ON p.id=r.seller_professional_id
    WHERE r.id=$1::uuid
  `,[request.id]);
  const target=recipient.rows[0];
  if(target?.professional_person_id){
    await db.query(`INSERT INTO notification_intents
      (id,domain_event_id,recipient_person_id,audience,channel,dedupe_key)
      VALUES($1::uuid,$2::uuid,$3::uuid,'SELLER','IN_APP',$4)`,[
      randomUUID(),eventId,target.professional_person_id,dedupeKey,
    ]);
  }else if(target?.organization_id){
    await db.query(`INSERT INTO notification_intents
      (id,domain_event_id,recipient_org_id,audience,channel,dedupe_key)
      VALUES($1::uuid,$2::uuid,$3::uuid,'SELLER','IN_APP',$4)`,[
      randomUUID(),eventId,target.organization_id,dedupeKey,
    ]);
  }else throw new ScheduleProposalRejected('conflict');
}

function readStoredResult(value:unknown,requestId:string,action:ScheduleProposalAction,expectedVersion:number):ScheduleProposalCommandResult{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ScheduleProposalRejected('conflict');
  const result=value as Record<string,unknown>;
  const expectedStatus=action==='propose'?'proposed':action==='decline'?'declined':'confirmed';
  if(result.request_id!==requestId||result.status!==expectedStatus||
     result.request_version!==expectedVersion+1||typeof result.id!=='string'||
     (typeof result.revision!=='number'||!Number.isSafeInteger(result.revision)||result.revision<1)||
     (result.initiator!=='customer'&&result.initiator!=='seller')||
     typeof result.start_at!=='string'||!Number.isFinite(Date.parse(result.start_at))||
     typeof result.end_at!=='string'||!Number.isFinite(Date.parse(result.end_at))||
     Date.parse(result.end_at)<=Date.parse(result.start_at)||
     typeof result.timezone!=='string'||!result.timezone||
     result.replayed!==false||
     (action==='confirm'&&
       (typeof result.confirmed_at!=='string'||!Number.isFinite(Date.parse(result.confirmed_at))||
        typeof result.cancellation_deadline_at!=='string'||
        !Number.isFinite(Date.parse(result.cancellation_deadline_at))||
        Date.parse(result.cancellation_deadline_at)>Date.parse(result.start_at)||
        Date.parse(result.confirmed_at)>Date.parse(result.start_at))))){
    throw new ScheduleProposalRejected('conflict');
  }
  return {...result,replayed:true} as ScheduleProposalCommandResult;
}
