import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHmac,X509Certificate} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
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

test('real localhost mTLS OTP HTTP flow authorizes peer then verifies HMAC and sends once',
 async()=>{
  const dir=mkdtempSync(join(tmpdir(),'services-otp-e2e-'));
  const openssl=(...args:string[])=>execFileSync('openssl',args,{
   cwd:dir,stdio:'ignore',timeout:15_000,
  });
  const read=(name:string)=>readFileSync(join(dir,name),'utf8');
  let server:ReturnType<typeof createOtpGatewayMtlsReferenceServer>|undefined;
  try{
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
   const signature=(contents:string)=>createHmac('sha256',config.idempotencySecret)
    .update('services-guest-otp-payload:v1\n')
    .update(key).update('\n').update(contents).digest('hex');
   let claims=0;
   let sends=0;
   let accepted=false;
   const ledger=new OtpGatewayLedgerDispatchReference({
    claim:async(_key:string,fingerprint:string)=>{
     claims++;
     if(fingerprint!==signature(body))return {decision:'conflict' as const};
     if(accepted)return {decision:'accepted' as const,
      providerRef:'provider_12345678'};
     return {decision:'send' as const};
    },
    recordAccepted:async()=>{
     accepted=true;
     return true;
    },
   });
   const approvedPin=new X509Certificate(read('client.crt'))
    .fingerprint256.replace(/:/g,'').toLowerCase();
   server=createOtpGatewayMtlsReferenceServer({
    key:read('server.key'),cert:read('server.crt'),ca:read('ca.crt'),
    approvedPins:()=>[approvedPin],
   },createOtpGatewayReferenceHttpHandler(
    config,ledger,payload=>({
     sendOnce:async()=>{
      sends++;
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
   const send=(options?:{badSignature?:boolean;clientCert?:boolean;path?:string}):
     Promise<{status:number|null;body:string;cache:string|null}>=>
     new Promise(resolve=>{
      let responded=false;
      const finish=(status:number|null,bodyText='',cache:string|null=null)=>{
       if(!responded){responded=true;resolve({status,body:bodyText,cache});}
      };
      const headers={
       'Authorization':'Bearer '+config.apiToken,
       'Idempotency-Key':key,
       'X-Services-Otp-Payload-Fingerprint':
        options?.badSignature?'f'.repeat(64):signature(body),
       'Content-Type':'application/json',
       'Content-Length':String(Buffer.byteLength(body)),
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
      req.end(body);
     });
   const success=await send();
   assert.equal(success.status,202);
   assert.deepEqual(JSON.parse(success.body),{
    accepted:true,providerRef:'provider_12345678',
   });
   assert.equal(success.cache,'no-store');
   assert.equal(claims,1);
   assert.equal(sends,1);
   const replay=await send();
   assert.equal(replay.status,202);
   assert.equal(claims,2);
   assert.equal(sends,1);
   const malformed=await send({badSignature:true});
   assert.equal(malformed.status,503);
   assert.equal(malformed.body,'{"accepted":false}');
   assert.equal(claims,2);
   assert.equal(sends,1);
   const wrongRoute=await send({path:'/v1/send?unexpected=1'});
   assert.equal(wrongRoute.status,404);
   assert.equal(claims,2);
   assert.equal(sends,1);
   const missingCert=await send({clientCert:false});
   assert.notEqual(missingCert.status,202);
   assert.equal(claims,2);
   assert.equal(sends,1);
  }finally{
   if(server){
    server.closeAllConnections();
    await new Promise<void>(resolve=>server!.close(()=>resolve()));
   }
   rmSync(dir,{recursive:true,force:true});
  }
 });
