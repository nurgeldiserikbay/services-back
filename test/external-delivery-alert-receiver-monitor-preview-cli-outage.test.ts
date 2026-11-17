import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('receiver preview CLI fails closed on PostgreSQL outage without disclosing connection credentials',()=>{
 const privateCredential='db_outage_preview_secret_must_be_redacted';
 const unavailableUrl=`postgres://preview:${privateCredential}@127.0.0.1:1/not_a_database`;
 const result=spawnSync(process.execPath,
  ['--import','tsx','scripts/preview-receiver-monitor.ts'],{
   cwd:process.cwd(),
   env:{
    ...process.env,
    DATABASE_URL:unavailableUrl,
    RECEIVER_MONITOR_SCOPE:'staging-only',
    RECEIVER_MONITOR_PREVIEW_ACK:'READ_ONLY_STAGING',
    RECEIVER_MONITOR_RETRY_SCHEDULED:'1',
    RECEIVER_MONITOR_LEASED_EXPIRED:'1',
    RECEIVER_MONITOR_TERMINAL:'1',
    RECEIVER_MONITOR_INCONSISTENT:'1',
   },
   encoding:'utf8',
   timeout:15000,
   maxBuffer:64*1024,
  });
 assert.equal(result.error,undefined);
 assert.equal(result.status,1);
 assert.equal(result.stdout,'');
 assert.equal(result.stderr,'receiver_monitor_preview_failed\n');
 assert.equal((result.stdout+result.stderr).includes(privateCredential),false);
 assert.equal((result.stdout+result.stderr).includes(unavailableUrl),false);
 assert.equal((result.stdout+result.stderr).includes('ECONNREFUSED'),false);
});
