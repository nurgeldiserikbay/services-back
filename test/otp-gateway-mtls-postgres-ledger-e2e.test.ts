import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHmac,X509Certificate,randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {Pool} from 'pg';
import {request as httpsRequest} from 'node:https';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createOtpGatewayMtlsReferenceServer} from
 '../src/platform/ingress/otp-gateway-mtls-listener.reference.js';
import {createOtpGatewayReferenceHttpHandler} from
 '../src/platform/ingress/otp-gateway-http-handler.reference.js';
import {OtpGatewayLedgerDispatchReference} from
 '../src/platform/ingress/otp-gateway-ledger-dispatch.reference.js';
import {OtpGatewayPostgresLedger} from
 '../src/platform/ingress/otp-gateway-postgres-ledger.reference.js';

test('real mTLS OTP HTTP uses committed PostgreSQL gateway ledger for one-shot delivery',
 {skip:!process.env.DATABASE_URL},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'services-otp-e2e-'));
  const openssl=(...args:string[])=>execFileSync('openssl',args,{
   cwd:dir,stdio:'ignore',timeout:15_000,
  });
  const read=(name:string)=>readFileSync(join(dir,name),'utf8');
  let server:ReturnType<typeof createOtpGatewayMtlsReferenceServer>|undefined;
  const schema='otp_tls_e2e_'+randomBytes(8).toString('hex');
  const admin=new Pool({connectionString:process.env.DATABASE_URL,max:1});
  let db:Pool|undefined;
  try{
   await admin.query('CREATE SCHEMA '+schema);
   db=new Pool({connectionString:process.env.DATABASE_URL,
    options:'-c search_path='+schema,max:4});
   await db.query(readFileSync('docs/reference/otp-gateway-idempotency-ledger.sql','utf8'));
   openssl('req','-x509','-newkey','rsa:2048','-nodes',
    '-keyout','server.key','-out','server.crt','-days','1',
    '-subj','/CN=localhost',
    '-addext','subjectAltName=DNS:localhost,IP:127.0.0.1');
   openssl('req','-x509','-newkey','rsa:2048','-nodes',
    '-keyout','ca.key','-out','ca.crt','-days','1',
    '-subj','/CN=OTP Integration CA');
   openssl('req','-new','-newkey','rsa:2048','-nodes',
    '-keyout','client.key','-out','client.csr','-subj','/CN=OTP BFF');
   openssl('x509','-req','-in','client.csr','-CA','ca.crt',
    '-CAkey','ca.key','-CAcreateserial','-out','client.crt',
    '-days','1','-sha256');

   const config={apiToken:'fixture'.repeat(8),
    idempotencySecret:Buffer.alloc(32,42)};
   const key='a'.repeat(64);
   const body=JSON.stringify({
    channel:'email',destination:'person@example.org',code:'123456',
    purpose:'CREATE_REQUEST',locale:'kk',expiresInSeconds:600,
   });
   const signature=(contents:string,requestKey=key)=>createHmac('sha256',config.idempotencySecret)
    .update('services-guest-otp-payload:v1\n')
    .update(requestKey).update('\n').update(contents).digest('hex');
   let sends=0;
   const durableLedger=new OtpGatewayPostgresLedger(db!);
   const ledger=new OtpGatewayLedgerDispatchReference(durableLedger);
   const stored=async(requestKey=key)=>{
    const result=await db!.query<{status:string;provider_ref:string|null}>(
     'SELECT status,provider_ref FROM otp_gateway_delivery_claims WHERE idempotency_key=$1',
     [requestKey],
    );
    return result.rows;
   };
   const approvedPin=new X509Certificate(read('client.crt'))
    .fingerprint256.replace(/:/g,'').toLowerCase();
   server=createOtpGatewayMtlsReferenceServer({
    key:read('server.key'),cert:read('server.crt'),ca:read('ca.crt'),
    approvedPins:()=>[approvedPin],
   },createOtpGatewayReferenceHttpHandler(
    config,ledger,payload=>({
     sendOnce:async()=>{
      sends++;
      if(payload.code==='000000')throw new Error('test provider ambiguous failure');
      assert.equal(payload.code,'123456');
      return {accepted:true,providerRef:'provider_12345678'};
     },
    }),
   ));
   await new Promise<void>((resolve,reject)=>{
    server!.once('error',reject);
    server!.listen(0,'127.0.0.1',resolve);
   });
   const addr=server.address();
   assert.ok(addr&&typeof addr!=='string');
   const send=(options?:{badSignature?:boolean;clientCert?:boolean;path?:string;alternateBody?:boolean;vendorFailure?:boolean}):
     Promise<{status:number|null;body:string;cache:string|null}>=>
     new Promise(resolve=>{
      let responded=false;
      const finish=(status:number|null,bodyText='',cache:string|null=null)=>{
       if(!responded){responded=true;resolve({status,body:bodyText,cache});}
      };
      const requestBody=options?.vendorFailure
       ?body.replace('"code":"123456"','"code":"000000"')
        .replace('"locale":"kk"',options.alternateBody?'"locale":"ru"':'"locale":"kk"')
       :options?.alternateBody
        ?body.replace('"code":"123456"','"code":"654321"'):body;
      const requestKey=options?.vendorFailure?'b'.repeat(64):key;
      const headers={
       'Authorization':'Bearer '+config.apiToken,
       'Idempotency-Key':requestKey,
       'X-Services-Otp-Payload-Fingerprint':
        options?.badSignature?'f'.repeat(64):signature(requestBody,requestKey),
       'Content-Type':'application/json',
       'Content-Length':String(Buffer.byteLength(requestBody)),
      };
      const req=httpsRequest({
       hostname:'127.0.0.1',port:addr.port,servername:'localhost',
       path:options?.path??'/v1/send',method:'POST',
       ca:read('server.crt'),rejectUnauthorized:true,
       ...(options?.clientCert===false?{}:{
        key:read('client.key'),cert:read('client.crt'),
       }),
       headers,timeout:2_000,
      },res=>{
       const chunks:Buffer[]=[];
       res.on('data',(chunk:Buffer)=>chunks.push(chunk));
       res.once('end',()=>finish(res.statusCode??null,
        Buffer.concat(chunks).toString('utf8'),
        String(res.headers['cache-control']??'')));
      });
      req.once('timeout',()=>req.destroy());
      req.once('error',()=>finish(null));
      req.end(requestBody);
     });
   // Deny unauthenticated and malformed ingress before the first ledger claim.
   // A later successful send must not hide an earlier unwanted DB mutation.
   const firstBadSignature=await send({badSignature:true});
   assert.equal(firstBadSignature.status,503);
   assert.equal(firstBadSignature.body,'{"accepted":false}');
   assert.equal(firstBadSignature.cache,'no-store');
   assert.deepEqual(await stored(),[]);
   assert.equal(sends,0);
   const firstWrongRoute=await send({path:'/v1/send?unexpected=1'});
   assert.equal(firstWrongRoute.status,404);
   assert.deepEqual(await stored(),[]);
   assert.equal(sends,0);
   const firstMissingCert=await send({clientCert:false});
   assert.notEqual(firstMissingCert.status,202);
   assert.deepEqual(await stored(),[]);
   assert.equal(sends,0);
   const simultaneous=await Promise.all([send(),send()]);
   assert.ok(simultaneous.some(x=>x.status===202));
   assert.ok(simultaneous.every(x=>x.status===202||x.status===409));
   for(const item of simultaneous){
    if(item.status===202){
     assert.deepEqual(JSON.parse(item.body),{
      accepted:true,providerRef:'provider_12345678',
     });
     assert.equal(item.cache,'no-store');
    }else assert.equal(item.body,'{"accepted":false}');
   }
   assert.deepEqual(await stored(),[{status:'ACCEPTED',provider_ref:'provider_12345678'}]);
   assert.equal(sends,1);
   // An authenticated change of body under an already-accepted key
   // must conflict rather than send another OTP or overwrite its receipt.
   const conflictingPayload=await send({alternateBody:true});
   assert.equal(conflictingPayload.status,409);
   assert.equal(conflictingPayload.body,'{"accepted":false}');
   assert.equal(conflictingPayload.cache,'no-store');
   assert.equal(sends,1);
   assert.deepEqual(await stored(),[
    {status:'ACCEPTED',provider_ref:'provider_12345678'},
   ]);
   const replay=await send();
   assert.equal(replay.status,202);
   assert.equal(sends,1);
   const malformed=await send({badSignature:true});
   assert.equal(malformed.status,503);
   assert.equal(malformed.body,'{"accepted":false}');
   assert.equal(sends,1);
   assert.deepEqual(await stored(),[{status:'ACCEPTED',provider_ref:'provider_12345678'}]);
   const wrongRoute=await send({path:'/v1/send?unexpected=1'});
   assert.equal(wrongRoute.status,404);
   assert.equal(sends,1);
   // A provider failure after durable claim is ambiguous. Never retry it
   // automatically, even if a later request carries the same valid signature.
   const failedVendor=await send({vendorFailure:true});
   assert.equal(failedVendor.status,503);
   assert.equal(failedVendor.body,'{"accepted":false}');
   assert.deepEqual(await stored('b'.repeat(64)),[
    {status:'RESERVED',provider_ref:null},
   ]);
   assert.equal(sends,2);
   const ambiguousReplay=await send({vendorFailure:true});
   assert.equal(ambiguousReplay.status,409);
   assert.equal(ambiguousReplay.body,'{"accepted":false}');
   assert.deepEqual(await stored('b'.repeat(64)),[
    {status:'RESERVED',provider_ref:null},
   ]);
   assert.equal(sends,2);
   // A different authenticated body under an unresolved RESERVED key
   // must conflict without touching the provider or releasing the claim.
   const changedUnresolved=await send({vendorFailure:true,alternateBody:true});
   assert.equal(changedUnresolved.status,409);
   assert.equal(changedUnresolved.body,'{"accepted":false}');
   assert.equal(changedUnresolved.cache,'no-store');
   assert.deepEqual(await stored('b'.repeat(64)),[
    {status:'RESERVED',provider_ref:null},
   ]);
   assert.equal(sends,2);
   const missingCert=await send({clientCert:false});
   assert.notEqual(missingCert.status,202);
   // One accepted send plus one deliberately failed vendor attempt.
   assert.equal(sends,2);
   assert.deepEqual(await stored(),[{status:'ACCEPTED',provider_ref:'provider_12345678'}]);
   assert.deepEqual(await stored('b'.repeat(64)),[
    {status:'RESERVED',provider_ref:null},
   ]);
  }finally{
   if(server){
    server.closeAllConnections();
    await new Promise<void>(resolve=>server!.close(()=>resolve()));
   }
   if(db)await db.end();
   await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');
   await admin.end();
   rmSync(dir,{recursive:true,force:true});
  }
 });
