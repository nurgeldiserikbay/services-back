import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {AccountBearerSessionController}
 from '../src/modules/identity/account-bearer-session.controller.js';
import {AccountBearerSessionService}
 from '../src/modules/identity/account-bearer-session.service.js';
import {issueSessionToken,resolveActiveUserSession}
 from '../src/modules/identity/session-proof.js';

/** Real loopback Nest HTTP + PostgreSQL transaction. No real customer or OTP. */
test('account session HTTP cannot revoke foreign sessions and logout invalidates bearer',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 await db.query('BEGIN');
 const prior=process.env.ACCOUNT_SESSION_HMAC_KEY;
 const pepper=randomBytes(32);
 process.env.ACCOUNT_SESSION_HMAC_KEY=pepper.toString('base64');
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 try{
  const owner=randomUUID(),outsider=randomUUID();
  const ownerSession=randomUUID(),siblingSession=randomUUID(),foreignSession=randomUUID();
  const ownerToken=issueSessionToken(pepper),siblingToken=issueSessionToken(pepper);
  const foreignToken=issueSessionToken(pepper);
  await db.query('INSERT INTO users(id) VALUES($1),($2)',[owner,outsider]);
  for(const [id,user,token] of [
   [ownerSession,owner,ownerToken],[siblingSession,owner,siblingToken],
   [foreignSession,outsider,foreignToken],
  ] as const){
   await db.query(`INSERT INTO sessions
    (id,user_id,token_hash,family_id,expires_at)
    VALUES($1,$2,$3,$4,now()+interval '1 day')`,
    [id,user,token.hash,randomUUID()]);
  }
  const service=new AccountBearerSessionService({
   transaction:async<T>(work:(client:Client)=>Promise<T>):Promise<T>=>work(db),
  } as never);
  @Module({
   controllers:[AccountBearerSessionController],
   providers:[{provide:AccountBearerSessionService,useValue:service}],
  })
  class SessionRouteTestModule{}
  app=await NestFactory.create(SessionRouteTestModule,{logger:false});
  app.setGlobalPrefix('v1');
  await app.listen(0,'127.0.0.1');
  const url=(await app.getUrl())+'/v1/auth';
  const request=(path:string,method:string,token?:string)=>fetch(url+path,{
   method,redirect:'manual',
   headers:token?{Authorization:'Bearer '+token}:{},
  });

  const anonymous=await request('/sessions','GET');
  assert.equal(anonymous.status,401);
  const invalid=await request('/sessions/'+siblingSession,'DELETE');
  assert.equal(invalid.status,401);
  const invalidTarget=await request('/sessions/not-a-uuid','DELETE',ownerToken.token);
  assert.equal(invalidTarget.status,400);
  assert.ok(await resolveActiveUserSession(db,siblingToken.token,pepper));

  const first=await request('/sessions','GET',ownerToken.token);
  assert.equal(first.status,200);
  assert.match(first.headers.get('cache-control')??'',/no-store/);
  assert.equal(first.headers.get('set-cookie'),null);
  const list=await first.json() as {items:Array<{id:string;current:boolean}>};
  assert.equal(list.items.length,2);
  assert.equal(list.items.some(x=>x.id===ownerSession&&x.current),true);
  assert.equal(list.items.some(x=>x.id===foreignSession),false);
  const listText=JSON.stringify(list);
  for(const secret of [ownerToken.token,siblingToken.token,foreignToken.token,
   ownerToken.hash.toString('hex')])assert.equal(listText.includes(secret),false);

  // Target UUID existence is never disclosed: both unknown and foreign return 204.
  const foreign=await request('/sessions/'+foreignSession,'DELETE',ownerToken.token);
  const missing=await request('/sessions/'+randomUUID(),'DELETE',ownerToken.token);
  assert.equal(foreign.status,204);
  assert.equal(missing.status,204);
  assert.ok(await resolveActiveUserSession(db,foreignToken.token,pepper));
  assert.ok(await resolveActiveUserSession(db,siblingToken.token,pepper));

  const revoked=await request('/sessions/'+siblingSession,'DELETE',ownerToken.token);
  assert.equal(revoked.status,204);
  assert.equal(await resolveActiveUserSession(db,siblingToken.token,pepper),null);
  assert.equal((await request('/sessions','GET',siblingToken.token)).status,401);
  assert.equal((await request('/sessions','GET',ownerToken.token)).status,200);
  assert.ok(await resolveActiveUserSession(db,foreignToken.token,pepper));

  const logout=await request('/logout','POST',ownerToken.token);
  assert.equal(logout.status,204);
  assert.equal(await resolveActiveUserSession(db,ownerToken.token,pepper),null);
  assert.equal((await request('/sessions','GET',ownerToken.token)).status,401);
  assert.equal((await request('/logout','POST',ownerToken.token)).status,401);
  assert.equal((await request('/sessions','GET',foreignToken.token)).status,200);
  assert.equal((await db.query<{n:string}>(`
   SELECT count(*)::text n FROM sessions
   WHERE id=$1 AND revoked_at IS NULL`,[foreignSession])).rows[0].n,'1');
 }finally{
  if(app)await app.close();
  if(prior===undefined)delete process.env.ACCOUNT_SESSION_HMAC_KEY;
  else process.env.ACCOUNT_SESSION_HMAC_KEY=prior;
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});
