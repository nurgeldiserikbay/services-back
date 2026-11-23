import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {createSecureContext,TLSSocket} from 'node:tls';
import {test} from 'node:test';
import {Pool} from 'pg';
import {makeOtpGatewayMonitorPoolConfig} from
 '../src/platform/ingress/otp-gateway-monitor-tls.reference.js';

// A local PostgreSQL SSLRequest wire-protocol peer. This proves that pg
// negotiates a real TLS handshake with hostname and CA validation enabled,
// not that a real OTP gateway database has been deployed or approved.
test('OTP monitor PostgreSQL SSLRequest requires correct CA and hostname',
 {timeout:25_000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'otp-pg-tls-'));
 const run=(...args:string[])=>execFileSync('openssl',args,{
  cwd:dir,stdio:'pipe',timeout:5_000,
 });
 const ca=(prefix:string)=>{
  run('req','-x509','-newkey','rsa:2048','-nodes','-days','2',
   '-subj','/CN=Test OTP Gateway CA '+prefix,
   '-addext','basicConstraints=critical,CA:TRUE',
   '-keyout',prefix+'.key','-out',prefix+'.crt');
  return readFileSync(join(dir,prefix+'.crt'),'utf8');
 };
 let server:ReturnType<typeof createServer>|undefined;
 try{
  const trustedCa=ca('trusted');
  const otherCa=ca('other');
  run('req','-newkey','rsa:2048','-nodes',
   '-subj','/CN=localhost',
   '-keyout','server.key','-out','server.csr');
  writeFileSync(join(dir,'server.ext'),
   'subjectAltName=DNS:localhost\nbasicConstraints=critical,CA:FALSE\n'+
   'extendedKeyUsage=serverAuth\n');
  run('x509','-req','-in','server.csr','-CA','trusted.crt',
   '-CAkey','trusted.key','-CAcreateserial','-days','2',
   '-extfile','server.ext','-out','server.crt');
  const context=createSecureContext({
   cert:readFileSync(join(dir,'server.crt')),
   key:readFileSync(join(dir,'server.key')),
  });
  let handshakes=0;
  server=createServer(socket=>{
   socket.once('data',request=>{
    // PostgreSQL protocol: length=8, SSLRequest code=80877103.
    if(request.length!==8||request.readInt32BE(0)!==8||
      request.readInt32BE(4)!==80877103){
     socket.destroy();
     return;
    }
    socket.write('S',()=>{
     const encrypted=new TLSSocket(socket,{
      isServer:true,secureContext:context,
     });
     encrypted.on('error',()=>{});
     encrypted.once('secure',()=>{
      handshakes++;
      // Close after SSL handshake; no fake database authentication.
      encrypted.end();
     });
    });
   });
   socket.on('error',()=>{});
  });
  await new Promise<void>((resolve,reject)=>{
   server!.once('error',reject);
   server!.listen(0,resolve);
  });
  const address=server.address();
  assert.ok(address&&typeof address!=='string');
  const urlFor=(host:string)=>
   'postgresql://observer:dummy@'+host+':'+address.port+'/gateway';
  const attempt=async(host:string,root:string)=>{
   const pool=new Pool(makeOtpGatewayMonitorPoolConfig(urlFor(host),root));
   try{
    // The synthetic peer deliberately terminates after TLS negotiation.
    await assert.rejects(pool.connect());
   }finally{
    await pool.end();
   }
  };
  await attempt('localhost',trustedCa);
  assert.equal(handshakes,1,'trusted CA + hostname must complete real TLS');
  await attempt('localhost',otherCa);
  assert.equal(handshakes,1,'untrusted CA must fail before secure handshake');
  await attempt('127.0.0.1',trustedCa);
  assert.equal(handshakes,1,'hostname mismatch must fail before secure handshake');
 }finally{
  if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
  rmSync(dir,{recursive:true,force:true});
 }
});
