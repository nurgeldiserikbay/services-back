import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

test('one-shot staging HTTPS CLI with healthy PostgreSQL scope does not contact provider',()=>{
 const connectionString=process.env.DATABASE_URL;
 assert.ok(connectionString,'PostgreSQL DATABASE_URL is required for staging send E2E');
 const scope='staging-send-empty-'+randomUUID().replaceAll('-','').slice(0,18);
 const token='staging_test_only_secret_'+'a'.repeat(32);
 const child=spawnSync(process.execPath,
  ['--import','tsx','scripts/send-receiver-monitor-staging.ts'],{
   cwd:process.cwd(),
   env:{
    ...process.env,
    NODE_ENV:'test',
    DATABASE_URL:connectionString,
    RECEIVER_MONITOR_ENVIRONMENT:'staging',
    RECEIVER_MONITOR_SEND_ACK:'SEND_ONCE_STAGING',
    RECEIVER_MONITOR_PREVIEW_ACK:'READ_ONLY_STAGING',
    RECEIVER_MONITOR_SCOPE:scope,
    RECEIVER_MONITOR_RETRY_SCHEDULED:'1',
    RECEIVER_MONITOR_LEASED_EXPIRED:'1',
    RECEIVER_MONITOR_TERMINAL:'1',
    RECEIVER_MONITOR_INCONSISTENT:'1',
    // No network connection should be made for a healthy snapshot.
    RECEIVER_MONITOR_ENDPOINT:'https://alerts.example.org/unreachable',
    RECEIVER_MONITOR_APPROVED_HOSTNAME:'alerts.example.org',
    RECEIVER_MONITOR_BEARER_TOKEN:token,
    RECEIVER_MONITOR_TIMEOUT_MS:'1000',
   },
   encoding:'utf8',
   timeout:20000,
   maxBuffer:65536,
  });
 assert.equal(child.error,undefined);
 assert.equal(child.status,0,'healthy scope should not attempt HTTP');
 assert.equal(child.stderr,'');
 assert.deepEqual(JSON.parse(child.stdout),{
  mode:'one-shot-staging-send',breachCount:0,
 });
 assert.equal(child.stdout.split('\n').length,2);
 for(const secret of [scope,token,connectionString,'alerts.example.org'])
  assert.equal((child.stdout+child.stderr).includes(secret),false);
});
