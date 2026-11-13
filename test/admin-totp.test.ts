import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {verifyAdminTotp} from '../src/modules/admin/admin-totp.js';

const secret=randomBytes(32);
function codeAt(counter:number):string{
 const input=Buffer.alloc(8);
 input.writeBigUInt64BE(BigInt(counter));
 const digest=createHmac('sha1',secret).update(input).digest();
 const offset=digest[digest.length-1]!&15;
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,'0');
}
test('admin TOTP accepts a current valid code and returns its exact counter',()=>{
 const counter=123456;
 assert.equal(verifyAdminTotp(secret,codeAt(counter),counter*30000,-1),counter);
});
test('admin TOTP permits adjacent skew steps but rejects previously consumed counters',()=>{
 const counter=123456;
 const now=counter*30000;
 assert.equal(verifyAdminTotp(secret,codeAt(counter-1),now,-1),counter-1);
 assert.equal(verifyAdminTotp(secret,codeAt(counter+1),now,-1),counter+1);
 assert.equal(verifyAdminTotp(secret,codeAt(counter),now,counter),null);
 assert.equal(verifyAdminTotp(secret,codeAt(counter-1),now,counter-1),null);
});
test('admin TOTP rejects invalid inputs before cryptographic verification',()=>{
 const now=123456*30000;
 for(const code of ['12345','1234567','12345a',123456,null]){
  assert.equal(verifyAdminTotp(secret,code,now,-1),null);
 }
 assert.equal(verifyAdminTotp(Buffer.alloc(10),codeAt(123456),now,-1),null);
 assert.equal(verifyAdminTotp(secret,codeAt(123456),-1,-1),null);
 assert.equal(verifyAdminTotp(secret,codeAt(123456),now,-2),null);
});
