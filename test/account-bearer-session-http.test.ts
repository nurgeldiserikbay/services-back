import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {UnauthorizedException} from '@nestjs/common';
import {AccountBearerSessionController}
  from '../src/modules/identity/account-bearer-session.controller.js';
import {AccountBearerSessionService}
  from '../src/modules/identity/account-bearer-session.service.js';
import {issueSessionToken,resolveActiveUserSession}
  from '../src/modules/identity/session-proof.js';

test('HTTP account session controller rejects cookies and malformed Authorization',async()=>{
  let calls=0;
  const mock={
    list:async(_token:string)=>{calls++;return {items:[]};},
    logout:async(_token:string)=>{calls++;},
  };
  const controller=new AccountBearerSessionController(mock as never);
  for(const bad of [undefined,'Cookie token','Bearer short',
    'Basic abc','Bearer '+randomBytes(32).toString('base64url')+',other']){
    await assert.rejects(async()=>controller.list(bad),UnauthorizedException);
    await assert.rejects(async()=>controller.logout(bad),UnauthorizedException);
  }
  assert.equal(calls,0);
  const token=issueSessionToken(randomBytes(32)).token;
  assert.deepEqual(await controller.list('Bearer '+token),{items:[]});
  assert.equal(await controller.logout('Bearer '+token),undefined);
  assert.equal(calls,2);
});

test('bearer session HTTP service lists own sessions, logs out and immediately denies replay',async()=>{
  const db=new Client({connectionString:process.env.DATABASE_URL});
  const pepper=randomBytes(32),userId=randomUUID(),otherId=randomUUID();
  const current=issueSessionToken(pepper),foreign=issueSessionToken(pepper);
  await db.connect();await db.query('BEGIN');
  const original=process.env.ACCOUNT_SESSION_HMAC_KEY;
  process.env.ACCOUNT_SESSION_HMAC_KEY=pepper.toString('base64');
  try{
    await db.query('INSERT INTO users(id) VALUES($1),($2)',[userId,otherId]);
    await db.query(`
      INSERT INTO sessions(id,user_id,token_hash,family_id,expires_at)
      VALUES($1,$2,$3,$4,now()+interval '1 day'),
            ($5,$6,$7,$8,now()+interval '1 day')
    `,[randomUUID(),userId,current.hash,randomUUID(),
        randomUUID(),otherId,foreign.hash,randomUUID()]);
    const pool={transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(db)};
    const service=new AccountBearerSessionService(pool as never);
    const controller=new AccountBearerSessionController(service);
    const before=await controller.list('Bearer '+current.token);
    assert.equal(before.items.length,1);
    assert.equal(before.items[0].current,true);
    assert.equal(Object.keys(before.items[0]).includes('tokenHash'),false);
    assert.equal(JSON.stringify(before).includes(current.token),false);
    assert.equal(JSON.stringify(before).includes(foreign.token),false);
    await controller.logout('Bearer '+current.token);
    assert.equal(await resolveActiveUserSession(db,current.token,pepper),null);
    assert.ok(await resolveActiveUserSession(db,foreign.token,pepper));
    await assert.rejects(controller.list('Bearer '+current.token),
      UnauthorizedException);
    await assert.rejects(controller.logout('Bearer '+current.token),
      UnauthorizedException);
    assert.equal((await db.query<{n:string}>(`
      SELECT count(*)::text n FROM sessions
      WHERE user_id=$1 AND revoked_at IS NOT NULL`,[userId])).rows[0].n,'1');
  }finally{
    if(original===undefined)delete process.env.ACCOUNT_SESSION_HMAC_KEY;
    else process.env.ACCOUNT_SESSION_HMAC_KEY=original;
    await db.query('ROLLBACK').catch(()=>{});await db.end();
  }
});
