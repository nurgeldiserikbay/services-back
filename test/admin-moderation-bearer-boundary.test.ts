import assert from 'node:assert/strict';
import {test} from 'node:test';
import {UnauthorizedException} from '@nestjs/common';
import {PlatformModerationReadService} from '../src/modules/admin/admin-moderation-read.service.js';
import {issueAdminSessionToken} from '../src/modules/admin/admin-session-token.js';
import {DatabasePool} from '../src/platform/database/database.pool.js';

test('moderation endpoint rejects malformed admin authorization before database access',async()=>{
 const previousFlag=process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
 const previousKey=process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
 try{
  process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP='enabled';
  const pepper=Buffer.alloc(32,31);
  process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=pepper.toString('base64');
  const {token}=issueAdminSessionToken(pepper);
  let transactions=0;
  const db={async transaction(){transactions++;throw new Error('unexpected DB access');}};
  const service=new PlatformModerationReadService(db as unknown as DatabasePool);
  for(const authorization of [
   undefined,null,'','Bearer','Basic '+token,'bearer '+token,
   'Bearer  '+token,'Bearer '+token+' ','Bearer '+token+', Bearer '+token,
   'Bearer '+token+'=','Bearer '+token+'\n',
  ]){
   await assert.rejects(service.list(authorization),(error:unknown)=>
    error instanceof UnauthorizedException&&error.message==='Authentication required');
  }
  assert.equal(transactions,0);
 }finally{
  if(previousFlag===undefined)delete process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP;
  else process.env.SERVICES_ENABLE_PLATFORM_MODERATION_HTTP=previousFlag;
  if(previousKey===undefined)delete process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY;
  else process.env.PLATFORM_ADMIN_SESSION_HMAC_KEY=previousKey;
 }
});
