import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {Client} from 'pg';
import {AccountCustomerRequestsController} from
 '../src/modules/identity/account-customer-requests.controller.js';
import {AccountBearerSessionService} from
 '../src/modules/identity/account-bearer-session.service.js';
import {issueSessionToken} from '../src/modules/identity/session-proof.js';

test('registered customer HTTP inventory paginates only own requests, hides private fields and honors revocation',async()=>{
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 const prior=process.env.ACCOUNT_SESSION_HMAC_KEY;
 const pepper=randomBytes(32);
 process.env.ACCOUNT_SESSION_HMAC_KEY=pepper.toString('base64');
 const own=issueSessionToken(pepper),other=issueSessionToken(pepper);
 const users=[randomUUID(),randomUUID(),randomUUID()];
 const persons=[randomUUID(),randomUUID(),randomUUID()];
 const org=randomUUID(),definition=randomUUID(),offer=randomUUID();
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 try{
  for(let i=0;i<3;i++){
   await db.query('INSERT INTO users(id) VALUES($1)',[users[i]]);
   await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',[persons[i],users[i]]);
  }
  for(let i=0;i<2;i++){
   const token=i===0?own:other;
   await db.query(`INSERT INTO sessions
    (id,user_id,token_hash,family_id,expires_at)
    VALUES($1,$2,$3,$4,now()+interval '1 day')`,
    [randomUUID(),users[i],token.hash,randomUUID()]);
  }
  await db.query(`INSERT INTO organizations
   (id,owner_person_id,slug,name,status)
   VALUES($1,$2,$3,'Inventory seller','ACTIVE')`,
   [org,persons[2],'inventory-'+randomUUID()]);
  await db.query(`INSERT INTO service_definitions(id,code,name)
   VALUES($1,$2,'Inventory service')`,[definition,'inventory-'+randomUUID()]);
  await db.query(`INSERT INTO service_offers
   (id,definition_id,organization_id,title,status,delivery_mode,contacts)
   VALUES($1,$2,$3,'Inventory offer','PUBLISHED','online','{}'::jsonb)`,
   [offer,definition,org]);
  const ids:string[]=[];
  for(let i=0;i<23;i++){
   const id=randomUUID();
   if(i<22)ids.push(id);
   await db.query(`INSERT INTO service_requests
    (id,offer_id,customer_person_id,source_context,
     seller_organization_id,status,note,created_at)
    VALUES($1,$2,$3,'ORGANIZATION',$4,
     'ACCEPTED','PRIVATE INVENTORY NOTE',
     now()-($5::int*interval '1 minute'))`,
    [id,offer,persons[i<22?0:1],org,i]);
  }
  const service=new AccountBearerSessionService({
   transaction:async<T>(run:(db:Client)=>Promise<T>)=>run(db),
  } as never);
  @Module({controllers:[AccountCustomerRequestsController],
   providers:[{provide:AccountBearerSessionService,useValue:service}]})
  class IsolatedCustomerRequestsModule{}
  app=await NestFactory.create(IsolatedCustomerRequestsModule,{logger:false});
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const url=(await app.getUrl())+'/v1/account/requests';
  const get=(token?:string,cursor?:string)=>fetch(url+(cursor?'?cursor='+encodeURIComponent(cursor):''),{
   headers:token?{Authorization:'Bearer '+token}:undefined,redirect:'manual'});
  assert.equal((await get()).status,401);
  assert.equal((await get('invalid')).status,401);
  const page1=await get(own.token);
  assert.equal(page1.status,200);
  assert.match(page1.headers.get('cache-control')??'',/no-store/);
  const first=await page1.json() as {items:Array<{id:string;state:string;version:number;created_at:string}>;next_cursor:string};
  assert.equal(first.items.length,20);
  assert.equal(typeof first.next_cursor,'string');
  assert.ok(first.items.every(x=>ids.includes(x.id)&&x.version===1&&x.state==='accepted'));
  assert.equal(JSON.stringify(first).includes('PRIVATE INVENTORY NOTE'),false);
  const page2=await get(own.token,first.next_cursor);
  assert.equal(page2.status,200);
  const second=await page2.json() as {items:Array<{id:string}>;next_cursor:null};
  assert.equal(second.items.length,2);
  assert.equal(second.next_cursor,null);
  assert.deepEqual(new Set([...first.items,...second.items].map(x=>x.id)),new Set(ids));
  assert.equal((await get(own.token,'bad!')).status,400);
  assert.equal((await get(other.token)).status,200);
  const otherData=await (await get(other.token)).json() as {items:Array<{id:string}>};
  assert.equal(otherData.items.length,1);
  assert.ok(!ids.includes(otherData.items[0]!.id));
  await db.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[own.hash]);
  assert.equal((await get(own.token)).status,401);
 }finally{
  await app?.close();
  if(prior===undefined)delete process.env.ACCOUNT_SESSION_HMAC_KEY;
  else process.env.ACCOUNT_SESSION_HMAC_KEY=prior;
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
