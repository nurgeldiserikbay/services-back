import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {X509Certificate} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {request as httpsRequest, type Server} from 'node:https';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createOtpGatewayMtlsReferenceServer} from
 '../src/platform/ingress/otp-gateway-mtls-listener.reference.js';

/**
 * Real localhost HTTPS/mTLS handshake, not a mocked TLSSocket.
 * OpenSSL issues short-lived keys only inside a temporary directory.
 * Never commit private keys or treat these test certificates as deployment CAs.
 */
test('OTP real TLS mTLS handshake permits pinned clients and denies other peers',
 async()=>{
  const dir=mkdtempSync(join(tmpdir(),'services-otp-mtls-'));
  const openssl=(...args:string[])=>execFileSync('openssl',args,{
    cwd:dir,stdio:'ignore',timeout:15_000,
  });
  const read=(file:string)=>readFileSync(join(dir,file),'utf8');
  let server:Server|undefined;
  try{
    openssl('req','-x509','-newkey','rsa:2048','-nodes',
      '-keyout','server.key','-out','server.crt','-days','1',
      '-subj','/CN=localhost',
      '-addext','subjectAltName=DNS:localhost,IP:127.0.0.1');
    openssl('req','-x509','-newkey','rsa:2048','-nodes',
      '-keyout','trusted-ca.key','-out','trusted-ca.crt','-days','1',
      '-subj','/CN=OTP Test Client CA');
    for(const name of ['primary','staged']){
      openssl('req','-new','-newkey','rsa:2048','-nodes',
        '-keyout',name+'.key','-out',name+'.csr',
        '-subj','/CN=OTP Test '+name);
      openssl('x509','-req','-in',name+'.csr',
        '-CA','trusted-ca.crt','-CAkey','trusted-ca.key',
        '-CAcreateserial','-out',name+'.crt','-days','1',
        '-sha256');
    }
    openssl('req','-x509','-newkey','rsa:2048','-nodes',
      '-keyout','outsider.key','-out','outsider.crt','-days','1',
      '-subj','/CN=OTP Untrusted Client');
    const pin=(name:string)=>new X509Certificate(read(name+'.crt'))
      .fingerprint256.replace(/:/g,'').toLowerCase();
    let allowed=[pin('primary'),pin('staged')];
    let admitted=0;
    server=createOtpGatewayMtlsReferenceServer({
      key:read('server.key'),cert:read('server.crt'),
      ca:read('trusted-ca.crt'),
      approvedPins:()=>allowed,
    },(_req,res)=>{
      admitted++;
      res.writeHead(204,{'cache-control':'no-store'}).end();
    });
    assert.equal(server.maxHeadersCount,32);
    assert.equal(server.headersTimeout,5_000);
    assert.equal(server.requestTimeout,5_000);
    assert.equal(server.maxRequestsPerSocket,1);
    assert.equal(server.listening,false);
    await new Promise<void>((resolve,reject)=>{
      server!.once('error',reject);
      server!.listen(0,'127.0.0.1',resolve);
    });
    const addr=server.address();
    assert.ok(addr&&typeof addr!=='string');
    const connect=(name?:string):Promise<number|null>=>new Promise(resolve=>{
      const req=httpsRequest({
        hostname:'127.0.0.1',port:addr.port,servername:'localhost',
        path:'/v1/send',method:'POST',
        ca:read('server.crt'),rejectUnauthorized:true,
        ...(name?{key:read(name+'.key'),cert:read(name+'.crt')}:{ }),
        timeout:2_000,
      },res=>{
        const status=res.statusCode??null;
        res.resume();
        res.once('end',()=>resolve(status));
      });
      req.once('timeout',()=>req.destroy());
      req.once('error',()=>resolve(null));
      req.end();
    });
    assert.equal(await connect('primary'),204);
    assert.equal(await connect('staged'),204);
    // Removing the old pin must deny an otherwise CA-trusted TLS peer.
    allowed=[pin('staged')];
    assert.equal(await connect('primary'),403);
    assert.equal(await connect('staged'),204);
    // Node TLS itself must reject absent/untrusted client certificates.
    assert.notEqual(await connect(),204);
    assert.notEqual(await connect('outsider'),204);
    assert.equal(admitted,3);
  }finally{
    if(server){
      server.closeAllConnections();
      await new Promise<void>(resolve=>server!.close(()=>resolve()));
    }
    rmSync(dir,{recursive:true,force:true});
  }
 });
