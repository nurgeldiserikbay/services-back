
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {requeueFailedOrganizationDelivery}
 from '../src/modules/notifications/dead-letter-requeue.js';

// This is an integration test for disposable CI PostgreSQL, NOT a production
// drill. The audit table intentionally rejects DELETE/UPDATE, so the committed
// fixture is deliberately left in CI's throwaway database. Never run this test
// against a shared or persistent database.
const ciDatabase=process.env.DATABASE_URL;
const disposable=process.env.CI==='true'&&
  typeof ciDatabase==='string'&&
  /^postgres(?:ql)?:\/\//.test(ciDatabase)&&
  /\/services_test(?:[?#]|$)/.test(ciDatabase);

test('two PostgreSQL clients serialize requeue and keep a single immutable audit',{
 skip:disposable?false:'requires disposable CI services_test database',
 timeout:20000,
},async()=>{
 const first=new Client({connectionString:ciDatabase});
 const second=new Client({connectionString:ciDatabase});
 const observer=new Client({connectionString:ciDatabase});
 await Promise.all([first.connect(),second.connect(),observer.connect()]);
 const ids={
  user:randomUUID(),person:randomUUID(),org:randomUUID(),staff:randomUUID(),
  session:randomUUID(),grant:randomUUID(),event:randomUUID(),
  intent:randomUUID(),delivery:randomUUID(),key:randomUUID(),
 };
 const scope='organization:'+ids.org;
 const pepper=randomBytes(32);
 const {token,tokenHash}=issueAdminSessionToken(pepper);
 let providerCalls=0;
 let firstReady!:()=>void;
 let releaseFirst!:()=>void;
 let secondSelectStarted!:()=>void;
 const firstReadySignal=new Promise<void>(resolve=>{firstReady=resolve;});
 const firstCommitGate=new Promise<void>(resolve=>{releaseFirst=resolve;});
 const secondSelectSignal=new Promise<void>(resolve=>{secondSelectStarted=resolve;});
 const provider={
  supportsIdempotentSend:true as const,
  reconcile:async(key:string,channel:'EMAIL'|'SMS')=>{
   providerCalls++;
   assert.equal(key,'EMAIL:'+ids.intent);
   assert.equal(channel,'EMAIL');
   return 'NOT_FOUND' as const;
  },
 };
 const firstDb={
  query:first.query.bind(first),
  transaction:async<T>(fn:(client:Client)=>Promise<T>):Promise<T>=>{
   await first.query('BEGIN');
   try{
    const result=await fn(first);
    // Updates and audit are visible only to this transaction until COMMIT.
    firstReady();
    await firstCommitGate;
    await first.query('COMMIT');
    return result;
   }catch(error){
    await first.query('ROLLBACK').catch(()=>{});
    throw error;
   }
  },
 };
 const secondDb={
  query:second.query.bind(second),
  transaction:async<T>(fn:(client:Client)=>Promise<T>):Promise<T>=>{
   await second.query('BEGIN');
   try{
    await second.query("SET LOCAL lock_timeout = '8s'");
    const client={
     query:((sql:string,params?:unknown[])=>{
      if(sql.includes('FOR UPDATE OF d,n'))secondSelectStarted();
      return second.query(sql,params);
     }) as Client['query'],
    };
    const value=await fn(client as Client);
    await second.query('COMMIT');
    return value;
   }catch(error){
    await second.query('ROLLBACK').catch(()=>{});
    throw error;
   }
  },
 };
 try{
  // Commit the fixture so both independent backend connections can see it.
  await observer.query('INSERT INTO users(id) VALUES($1)',[ids.user]);
  await observer.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',
   [ids.person,ids.user]);
  await observer.query("INSERT INTO organizations(id,owner_person_id,slug,name,status) VALUES($1,$2,$3,'Concurrent requeue E2E','ACTIVE')",
   [ids.org,ids.person,'requeue-race-'+randomUUID()]);
  await observer.query("INSERT INTO platform_admin_staff(id,user_id,role) VALUES($1,$2,'admin')",
   [ids.staff,ids.user]);
  await observer.query("INSERT INTO platform_admin_sessions(id,staff_id,token_hash,mfa_verified_at,expires_at) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour')",
   [ids.session,ids.staff,tokenHash]);
  await observer.query("INSERT INTO platform_admin_totp_factors(staff_id,encrypted_secret,key_version,created_at,activated_at) VALUES($1,'test-concurrent-envelope','test',now()-interval '4 minutes',now()-interval '3 minutes')",
   [ids.staff]);
  await observer.query('INSERT INTO platform_admin_grants(id,staff_id,scope) VALUES($1,$2,$3)',
   [ids.grant,ids.staff,scope]);
  await observer.query("INSERT INTO domain_outbox_events(id,topic,subject_kind,subject_id,safe_payload) VALUES($1,'test.notification.requeue.race','Organization',$2,'{}'::jsonb)",
   [ids.event,ids.org]);
  await observer.query("INSERT INTO notification_intents(id,domain_event_id,recipient_org_id,audience,channel,state,attempts,dedupe_key) VALUES($1,$2,$3,'SELLER','EMAIL','FAILED',5,$4)",
   [ids.intent,ids.event,ids.org,'race-'+randomUUID()]);
  await observer.query("INSERT INTO notification_deliveries(id,intent_id,channel,state,attempt_count) VALUES($1,$2,'EMAIL','FAILED',5)",
   [ids.delivery,ids.intent]);

  const firstRequest=requeueFailedOrganizationDelivery(
   firstDb as never,provider,token,pepper,ids.delivery,ids.key,scope);
  // Wait until first transaction has written PENDING and inserted its audit,
  // but is deliberately held before COMMIT.
  await firstReadySignal;
  const secondRequest=requeueFailedOrganizationDelivery(
   secondDb as never,provider,token,pepper,ids.delivery,ids.key,scope);
  // The second request must have passed the preflight on a different client
  // and reached the SELECT ... FOR UPDATE before first transaction commits.
  await secondSelectSignal;
  releaseFirst();
  assert.equal(await firstRequest,'REQUEUED');
  assert.equal(await secondRequest,'ALREADY_REQUEUED');
  assert.equal(providerCalls,2);

  const durable=await observer.query<{
   delivery_state:string;intent_state:string;
   attempt_count:number;attempts:number;
  }>('SELECT d.state AS delivery_state,n.state AS intent_state,d.attempt_count,n.attempts FROM notification_deliveries d JOIN notification_intents n ON n.id=d.intent_id WHERE d.id=$1',[ids.delivery]);
  assert.deepEqual(durable.rows,[{
   delivery_state:'PENDING',intent_state:'PENDING',attempt_count:0,attempts:0,
  }]);
  const audit=await observer.query<{count:string}>(
   'SELECT count(*)::text AS count FROM notification_requeue_audit WHERE requeue_key=$1 AND delivery_id=$2',
   [ids.key,ids.delivery]);
  assert.equal(audit.rows[0]?.count,'1');
  // A second key after state transition is not a new requeue or provider call.
  assert.equal(await requeueFailedOrganizationDelivery(
   secondDb as never,provider,token,pepper,ids.delivery,randomUUID(),scope),
   'DENIED');
  assert.equal(providerCalls,2);
 }finally{
  releaseFirst();
  await Promise.all([
   first.query('ROLLBACK').catch(()=>{}),
   second.query('ROLLBACK').catch(()=>{}),
  ]);
  await Promise.all([first.end(),second.end(),observer.end()]);
 }
});
