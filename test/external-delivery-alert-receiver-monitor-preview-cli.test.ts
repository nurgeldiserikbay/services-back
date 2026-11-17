import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('preview CLI rejects absent operator acknowledgement without printing database secrets',()=>{
 const secret='preview_password_should_never_be_logged';
 const result=spawnSync(process.execPath,
  ['--import','tsx','scripts/preview-receiver-monitor.ts'],{
   cwd:process.cwd(),
   env:{
    ...process.env,
    DATABASE_URL:`postgres://preview:${secret}@127.0.0.1:1/staging`,
    RECEIVER_MONITOR_SCOPE:'staging-kz',
    RECEIVER_MONITOR_PREVIEW_ACK:'',
    RECEIVER_MONITOR_RETRY_SCHEDULED:'1',
    RECEIVER_MONITOR_LEASED_EXPIRED:'1',
    RECEIVER_MONITOR_TERMINAL:'1',
    RECEIVER_MONITOR_INCONSISTENT:'1',
   },
   encoding:'utf8',
   timeout:10000,
  });
 assert.equal(result.error,undefined);
 assert.equal(result.status,1);
 assert.equal(result.stdout,'');
 assert.equal(result.stderr,'receiver_monitor_preview_failed\n');
 assert.equal((result.stdout+result.stderr).includes(secret),false);
});

test('preview CLI rejects incomplete threshold config without exposing connection string',()=>{
 const secret='another_private_preview_password';
 const result=spawnSync(process.execPath,
  ['--import','tsx','scripts/preview-receiver-monitor.ts'],{
   cwd:process.cwd(),
   env:{
    ...process.env,
    DATABASE_URL:`postgres://preview:${secret}@127.0.0.1:1/staging`,
    RECEIVER_MONITOR_SCOPE:'staging-kz',
    RECEIVER_MONITOR_PREVIEW_ACK:'READ_ONLY_STAGING',
    RECEIVER_MONITOR_RETRY_SCHEDULED:'1',
    RECEIVER_MONITOR_LEASED_EXPIRED:'1',
    RECEIVER_MONITOR_TERMINAL:'0',
    RECEIVER_MONITOR_INCONSISTENT:'1',
   },
   encoding:'utf8',
   timeout:10000,
  });
 assert.equal(result.error,undefined);
 assert.equal(result.status,1);
 assert.equal(result.stdout,'');
 assert.equal(result.stderr,'receiver_monitor_preview_failed\n');
 assert.equal((result.stdout+result.stderr).includes(secret),false);
});
