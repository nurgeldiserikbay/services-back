import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {X509Certificate} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,request as httpsRequest} from 'node:https';
import type {Server} from 'node:https';
import {
  verifyOtpNodeMtlsPeerPins,
} from '../src/platform/ingress/otp-gateway-node-mtls.reference.js';

/**
 * Actual loopback TLS handshakes, not mocked TLSSocket instances.
 * Private keys and certificates are generated in an ephemeral directory and
 * are never checked into the repository. Requires OpenSSL on the CI runner.
 */
test('OTP mTLS validates real CA handshake, certificate pin rotation and denial',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'services-otp-mtls-'));
 let server:Server|undefined;
 const path=(name:string)=>join(dir,name);
 const openssl=(...args:string[])=>execFileSync('openssl',args,{
  cwd:dir,stdio:'ignore',timeout:15_000,
 });
 try{
  openssl('req','-x509','-newkey','rsa:2048','-nodes',
   '-keyout',path('ca.key'),'-out',path('ca.crt'),
   '-days','1','-sha256','-subj','/CN=OTP Temporary Test CA',
   '-addext','basicConstraints=critical,CA:TRUE',
   '-addext','keyUsage=critical,keyCertSign,cRLSign');
  const sign=(name:string,commonName:string,extension:string)=>{
   openssl('req','-new','-newkey','rsa:2048','-nodes',
    '-keyout',path(name+'.key'),'-out',path(name+'.csr'),
    '-subj','/CN='+commonName);
   writeFileSync(path(name+'.ext'),extension);
   openssl('x509','-req','-in',path(name+'.csr'),'-CA',path('ca.crt'),
    '-CAkey',path('ca.key'),'-CAcreateserial','-out',path(name+'.crt'),
    '-days','1','-sha256','-extfile',path(name+'.ext'));
  };
  sign('server','localhost',
   'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n');
  sign('client-a','otp-client-a',
   'extendedKeyUsage=clientAuth\nkeyUsage=digitalSignature\n');
  sign('client-b','otp-client-b',
   'extendedKeyUsage=clientAuth\nkeyUsage=digitalSignature\n');

  const certificate=(name:string)=>readFileSync(path(name+'.crt'));
  const privateKey=(name:string)=>readFileSync(path(name+'.key'));
  const pin=(name:string)=>new X509Certificate(certificate(name))
   .fingerprint256.replace(/:/g,'').toLowerCase();
  let approved=[pin('client-a')];
  let handled=0;
  let admitted=0;
  server=createServer({
   key:privateKey('server'),cert:certificate('server'),
   ca:certificate('ca'),requestCert:true,rejectUnauthorized:true,
   minVersion:'TLSv1.2',
  },(incoming,response)=>{
   handled++;
   try{
    verifyOtpNodeMtlsPeerPins(incoming,approved);
    admitted++;
    response.writeHead(204,{'cache-control':'no-store'}).end();
   }catch{
    response.writeHead(403,{'cache-control':'no-store'}).end();
   }
  });
  await new Promise<void>((resolve,reject)=>{
   server!.once('error',reject);
   server!.listen(0,'127.0.0.1',resolve);
  });
  const address=server.address();
  assert.ok(address&&typeof address!=='string');
  const send=(name?:string)=>new Promise<number>((resolve,reject)=>{
   const request=httpsRequest({
    hostname:'127.0.0.1',port:address.port,servername:'localhost',
    method:'POST',path:'/v1/send',agent:false,timeout:2_000,
    ca:certificate('ca'),key:name?privateKey(name):undefined,
    cert:name?certificate(name):undefined,
   },response=>{
    response.resume();
    response.once('end',()=>resolve(response.statusCode??0));
   });
   request.once('timeout',()=>request.destroy(new Error('test TLS timeout')));
   request.once('error',reject);
   request.end();
  });

  assert.equal(await send('client-a'),204);
  assert.equal(handled,1);
  assert.equal(admitted,1);

  // TLS trusts client-b's CA, but application fingerprint policy rejects it.
  assert.equal(await send('client-b'),403);
  assert.equal(handled,2);
  assert.equal(admitted,1);

  // Certificate rotation allows both trusted pins during a narrow overlap.
  approved=[pin('client-a'),pin('client-b')];
  assert.equal(await send('client-b'),204);
  assert.equal(admitted,2);

  // Complete revocation must work while the TLS CA still trusts old cert-a.
  approved=[pin('client-b')];
  assert.equal(await send('client-a'),403);
  assert.equal(admitted,2);

  // TLS itself must reject a missing client certificate before HTTP handler.
  const before=handled;
  await assert.rejects(send());
  assert.equal(handled,before);
 }finally{
  if(server){
   server.closeAllConnections();
   await new Promise<void>(resolve=>server!.close(()=>resolve()));
  }
  rmSync(dir,{recursive:true,force:true});
 }
});
