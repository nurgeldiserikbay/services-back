import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {NotFoundException,UnauthorizedException} from '@nestjs/common';
import {AccountLoginPrivateController}
 from '../src/modules/identity/account-login-private.controller.js';
import {AccountOtpSignInService}
 from '../src/modules/identity/account-otp-sign-in.service.js';
import {issueAccountOtpChallenge}
 from '../src/modules/identity/account-otp-issuance.js';
import {resolveActiveUserSession}
 from '../src/modules/identity/session-proof.js';

const secrets=()=>({
 otpPepper:randomBytes(32),contactPepper:randomBytes(32),
 contactKey:randomBytes(32),sessionPepper:randomBytes(32),
});
function configure(key:Buffer,work:()=>Promise<void>){
 const previous={
  enabled:process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP,
  key:process.env.ACCOUNT_LOGIN_BFF_KEY,
 };
 process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP='enabled';
 process.env.ACCOUNT_LOGIN_BFF_KEY=key.toString('base64');
 return work().finally(()=>{
  if(previous.enabled===undefined)delete process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP;
  else process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP=previous.enabled;
  if(previous.key===undefined)delete process.env.ACCOUNT_LOGIN_BFF_KEY;
  else process.env.ACCOUNT_LOGIN_BFF_KEY=previous.key;
 });
}

test('private verify is disabled by default and checks independent trusted BFF key before service',async()=>{
 let calls=0;
 const controller=new AccountLoginPrivateController({
  signIn:async()=>{calls++;throw new Error('must not run');},
 } as never);
 const valid={challenge_id:randomUUID(),channel:'EMAIL',code:'123456'};
 const key=randomBytes(32);
 await configure(key,async()=>{
  for(const wrong of [undefined,'invalid',randomBytes(32).toString('base64')]){
   await assert.rejects(controller.verify(wrong,valid),NotFoundException);
  }
  for(const bad of [
   {...valid,accountId:randomUUID()},
   {...valid,code:'12345'}, {...valid,channel:'PUSH'},
   {...valid,challenge_id:'wrong'},null,
  ]){
   await assert.rejects(controller.verify(key.toString('base64'),bad),UnauthorizedException);
  }
  assert.equal(calls,0);
  delete process.env.SERVICES_ENABLE_ACCOUNT_LOGIN_HTTP;
  await assert.rejects(controller.verify(key.toString('base64'),valid),NotFoundException);
 });
 assert.equal(calls,0);
});

test('private verified OTP issues only server-to-server session, once; wrong codes persist attempts',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query('BEGIN');
 const key=randomBytes(32),s=secrets(),userId=randomUUID();
 const email='private-login-'+randomUUID()+'@example.test';
 try{
  await configure(key,async()=>{
   await db.query('INSERT INTO users(id,email) VALUES($1,$2)',[userId,email]);
   const otp=await issueAccountOtpChallenge(db,{
    channel:'EMAIL',purpose:'SIGN_IN',contact:email,
   },s);
   const service=new AccountOtpSignInService({
    transaction:async<T>(work:(client:Client)=>Promise<T>)=>work(db),
   } as never,()=>s);
   const ctrl=new AccountLoginPrivateController(service);
   const input={challenge_id:otp.challengeId,channel:'EMAIL',code:otp.code};
   await assert.rejects(ctrl.verify(key.toString('base64'),input),UnauthorizedException);
   const invalid=otp.code==='123456'?'654321':'123456';
   await db.query('UPDATE account_auth_challenges SET delivery_confirmed_at=now() WHERE id=$1',
    [otp.challengeId]);
   await assert.rejects(ctrl.verify(randomBytes(32).toString('base64'),input),NotFoundException);
   const untouchedChallenge=await db.query<{attempts:number}>(
    'SELECT attempts FROM account_auth_challenges WHERE id=$1',[otp.challengeId]);
   assert.equal(untouchedChallenge.rows[0].attempts,0,
    'untrusted BFF must not consume or mutate a valid OTP challenge');
   await assert.rejects(ctrl.verify(key.toString('base64'),{...input,code:invalid}),
    UnauthorizedException);
   const attempts=await db.query<{attempts:number}>(
    'SELECT attempts FROM account_auth_challenges WHERE id=$1',[otp.challengeId]);
   assert.equal(attempts.rows[0].attempts,1);
   const noPrematureSessions=await db.query<{n:string}>(
    'SELECT count(*)::text n FROM sessions WHERE user_id=$1',[userId]);
   assert.equal(noPrematureSessions.rows[0].n,'0',
    'failed OTP attempts must not create an authenticated session');
   const reply=await ctrl.verify(key.toString('base64'),input);
   assert.deepEqual(Object.keys(reply).sort(),['expires_in_seconds','session_token']);
   assert.equal(reply.expires_in_seconds,43200);
   assert.match(reply.session_token,/^[A-Za-z0-9_-]{43}$/);
   const active=await resolveActiveUserSession(db,reply.session_token,s.sessionPepper);
   assert.equal(active?.userId,userId);
   await assert.rejects(ctrl.verify(key.toString('base64'),input),UnauthorizedException);
   const count=await db.query<{n:string}>(
    'SELECT count(*)::text n FROM sessions WHERE user_id=$1',[userId]);
   assert.equal(count.rows[0].n,'1');
  });
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
});
