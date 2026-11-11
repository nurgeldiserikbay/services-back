import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Buffer} from 'node:buffer';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {extractAdminBearerToken,verifyAdminBearerProof}
 from '../src/modules/admin/admin-bearer-proof.js';

test('admin bearer accepts only one canonical Authorization value',()=>{
 const pepper=Buffer.alloc(32,29);
 const {token,tokenHash}=issueAdminSessionToken(pepper);
 assert.equal(extractAdminBearerToken('Bearer '+token),token);
 assert.equal(verifyAdminBearerProof('Bearer '+token,tokenHash,pepper),true);
 for(const invalid of [
  null,undefined,42,{},[], '', 'bearer '+token,'Basic '+token,
  'Bearer  '+token,' Bearer '+token,'Bearer '+token+' ',
  'Bearer '+token+', Bearer '+token,'Bearer '+token+'=',
  'Bearer '+token+'\n', 'Bearer '+token+'\r\nBearer '+token,
  'Bearer '+token.slice(0,-1)+'B',
 ]){
  assert.equal(extractAdminBearerToken(invalid),null);
  assert.equal(verifyAdminBearerProof(invalid,tokenHash,pepper),false);
 }
 assert.equal(verifyAdminBearerProof('Bearer '+token,'f'.repeat(64),pepper),false);
 assert.equal(verifyAdminBearerProof('Bearer '+token,tokenHash,Buffer.alloc(32,30)),false);
});
