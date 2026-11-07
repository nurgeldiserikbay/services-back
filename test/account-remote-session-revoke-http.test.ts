import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {BadRequestException,UnauthorizedException} from '@nestjs/common';
import {AccountBearerSessionController}
 from '../src/modules/identity/account-bearer-session.controller.js';
import {AccountBearerSessionService}
 from '../src/modules/identity/account-bearer-session.service.js';
import {issueSessionToken,resolveActiveUserSession}
 from '../src/modules/identity/session-proof.js';

test('remote revoke HTTP requires an exact bearer and UUID; does not touch service on invalid input',async()=>{
 let calls=0;
 const controller=new AccountBearerSessionController({
   revokeSession:async()=>{calls++;},
 } as never);
 const target=randomUUID(),token=issueSessionToken(randomBytes(32)).token;
 for(const authorization of [null,'Bearer short','Basic '+token,
   'Bearer '+token+' extra']){
   await assert.rejects(controller.revokeSession(authorization,target),UnauthorizedException);
 }
 for(const invalid of ['bad','',null,42,'00000000-0000-0000-0000-000000000000']){
   await assert.rejects(controller.revokeSession('Bearer '+token,invalid),
     BadRequestException);
 }
 assert.equal(calls,0);
 await controller.revokeSession('Bearer '+token,target);
 assert.equal(calls,1);
});
test('remote revoke only owns active sessions; foreign UUID does not reveal existence',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 const pepper=randomBytes(32),prior=process.env.ACCOUNT_SESSION_HMAC_KEY;
 process.env.ACCOUNT_SESSION_HMAC_KEY=pepper.toString('base64');
 try{
   const owner=randomUUID(),other=randomUUID(),currentId=randomUUID();
   const siblingId=randomUUID(),foreignId=randomUUID();
   const current=issueSessionToken(pepper),sibling=issueSessionToken(pepper);
   const foreign=issueSessionToken(pepper);
   await db.query('INSERT INTO users(id) VALUES($1),($2)',[owner,other]);
   for(const [id,userId,token] of [
     [currentId,owner,current],[siblingId,owner,sibling],[foreignId,other,foreign],
   ] as const){
     await db.query(`INSERT INTO sessions
       (id,user_id,token_hash,family_id,expires_at)
       VALUES($1,$2,$3,$4,now()+interval '1 day')`,
       [id,userId,token.hash,randomUUID()]);
   }
   const service=new AccountBearerSessionService({
     transaction:async<T>(work:(client:Client)=>Promise<T>):Promise<T>=>work(db),
   } as never);
   const controller=new AccountBearerSessionController(service);
   const bearer='Bearer '+current.token;
   const before=await controller.list(bearer);
   assert.equal(before.items.length,2);
   await controller.revokeSession(bearer,foreignId);
   await controller.revokeSession(bearer,randomUUID());
   assert.ok(await resolveActiveUserSession(db,foreign.token,pepper));
   assert.equal((await controller.list(bearer)).items.length,2);
   await controller.revokeSession(bearer,siblingId);
   assert.equal(await resolveActiveUserSession(db,sibling.token,pepper),null);
   assert.ok(await resolveActiveUserSession(db,current.token,pepper));
   assert.equal((await controller.list(bearer)).items.length,1);
   await controller.revokeSession(bearer,siblingId); // idempotent
   await controller.revokeSession(bearer,currentId);
   assert.equal(await resolveActiveUserSession(db,current.token,pepper),null);
   await assert.rejects(controller.revokeSession(bearer,foreignId),
     UnauthorizedException);
   await assert.rejects(controller.list(bearer),UnauthorizedException);
 }finally{
   if(prior===undefined)delete process.env.ACCOUNT_SESSION_HMAC_KEY;
   else process.env.ACCOUNT_SESSION_HMAC_KEY=prior;
   await db.query('ROLLBACK').catch(()=>{});await db.end();
 }
});
