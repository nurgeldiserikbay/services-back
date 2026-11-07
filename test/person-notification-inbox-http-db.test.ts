import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {BadRequestException,UnauthorizedException} from '@nestjs/common';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';
import {PersonInboxController} from '../src/modules/notifications/person-inbox.controller.js';
import {PersonInboxService} from '../src/modules/notifications/person-inbox.service.js';

test('notifications HTTP requires strict bearer and bounded limit before accessing service',async()=>{
 let count=0;
 const service={list:async(_token:string,limit:number)=>{
  count++;return {items:[],limit};
 }};
 const route=new PersonInboxController(service as never);
 for(const header of [undefined,'Basic abc','Bearer short','Cookie x=1']){
  await assert.rejects(route.list(header,undefined),UnauthorizedException);
 }
 const token=issueSessionToken(randomBytes(32)).token;
 for(const bad of ['0','51','01','2.5','abc',null,['10']]){
  await assert.rejects(route.list('Bearer '+token,bad),BadRequestException);
 }
 assert.equal(count,0);
 assert.deepEqual(await route.list('Bearer '+token,undefined),{items:[],limit:20});
 assert.deepEqual(await route.list('Bearer '+token,'50'),{items:[],limit:50});
});

test('live account bearer reads only own delivered IN_APP notifications, revocation denies',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 const pepper=randomBytes(32);
 const current=issueSessionToken(pepper);
 const other=issueSessionToken(pepper);
 const personA=randomUUID(),personB=randomUUID(),userA=randomUUID(),userB=randomUUID();
 const notificationA=randomUUID(),notificationB=randomUUID();
 const eventA=randomUUID(),eventB=randomUUID();
 const old=process.env.ACCOUNT_SESSION_HMAC_KEY;
 await db.connect();await db.query('BEGIN');
 process.env.ACCOUNT_SESSION_HMAC_KEY=pepper.toString('base64');
 try{
  await db.query('INSERT INTO users(id) VALUES($1),($2)',[userA,userB]);
  await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2),($3,$4)',
    [personA,userA,personB,userB]);
  await db.query(`INSERT INTO sessions(id,user_id,token_hash,family_id,expires_at)
   VALUES($1,$2,$3,$4,now()+interval '1 day'),($5,$6,$7,$8,now()+interval '1 day')`,
   [randomUUID(),userA,current.hash,randomUUID(),randomUUID(),userB,other.hash,randomUUID()]);
  await db.query(`INSERT INTO domain_outbox_events
    (id,topic,subject_kind,subject_id,safe_payload)
    VALUES($1,'test.self.notice','ServiceRequest',$2,'{}'::jsonb),
          ($3,'test.other.notice','ServiceRequest',$4,'{}'::jsonb)`,
   [eventA,randomUUID(),eventB,randomUUID()]);
  await db.query(`INSERT INTO notification_intents
    (id,domain_event_id,recipient_person_id,audience,channel,dedupe_key,state)
    VALUES($1,$2,$3,'CLIENT','IN_APP',$4,'DELIVERED'),
          ($5,$6,$7,'CLIENT','IN_APP',$8,'DELIVERED')`,
   [notificationA,eventA,personA,'inbox-A-'+randomUUID(),
    notificationB,eventB,personB,'inbox-B-'+randomUUID()]);
  await db.query(`INSERT INTO notification_deliveries(id,intent_id,channel,state,delivered_at)
    VALUES($1,$2,'IN_APP','DELIVERED',now()),
          ($3,$4,'IN_APP','DELIVERED',now())`,
   [randomUUID(),notificationA,randomUUID(),notificationB]);
  const pool={transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(db)};
  const api=new PersonInboxController(new PersonInboxService(pool as never));
  const a=await api.list('Bearer '+current.token,'20');
  assert.equal(a.items.length,1);
  assert.equal(a.items[0].id,notificationA);
  assert.equal(a.items[0].topic,'test.self.notice');
  assert.match(a.items[0].created_at,/^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(a.items[0]).sort(),
   ['created_at','id','subject_id','topic']);
  assert.equal(JSON.stringify(a).includes(notificationB),false);
  assert.equal(JSON.stringify(a).includes(current.token),false);
  const b=await api.list('Bearer '+other.token,undefined);
  assert.equal(b.items.length,1);
  assert.equal(b.items[0].id,notificationB);
  await db.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[current.hash]);
  await assert.rejects(api.list('Bearer '+current.token,undefined),UnauthorizedException);
  assert.equal((await api.list('Bearer '+other.token,undefined)).items.length,1);
 }finally{
  if(old===undefined)delete process.env.ACCOUNT_SESSION_HMAC_KEY;
  else process.env.ACCOUNT_SESSION_HMAC_KEY=old;
  await db.query('ROLLBACK').catch(()=>{});await db.end();
 }
});
