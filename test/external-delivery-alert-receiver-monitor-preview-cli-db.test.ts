import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

test('one-shot preview CLI returns only count-only dry-run JSON for an isolated PostgreSQL scope',()=>{
 const suffix=randomUUID().replaceAll('-','').slice(0,18);
 const scope='preview-e2e-'+suffix;
 const connectionString=process.env.DATABASE_URL;
 assert.ok(connectionString,'PostgreSQL DATABASE_URL is required for CLI E2E');
 const child=spawnSync(process.execPath,
  ['--import','tsx','scripts/preview-receiver-monitor.ts'],{
   cwd:process.cwd(),
   env:{
    ...process.env,
    DATABASE_URL:connectionString,
    RECEIVER_MONITOR_SCOPE:scope,
    RECEIVER_MONITOR_PREVIEW_ACK:'READ_ONLY_STAGING',
    RECEIVER_MONITOR_RETRY_SCHEDULED:'1',
    RECEIVER_MONITOR_LEASED_EXPIRED:'1',
    RECEIVER_MONITOR_TERMINAL:'1',
    RECEIVER_MONITOR_INCONSISTENT:'1',
   },
   encoding:'utf8',
   timeout:20000,
   maxBuffer:1024*64,
  });
 assert.equal(child.error,undefined);
 assert.equal(child.status,0,'CLI must return success in a CI PostgreSQL fixture');
 assert.equal(child.stderr,'');
 assert.deepEqual(JSON.parse(child.stdout),{mode:'dry-run',breaches:[]});
 assert.equal(child.stdout.endsWith('\n'),true);
 assert.equal(child.stdout.trim().split('\n').length,1);
 for(const secret of [scope,connectionString])
  assert.equal((child.stdout+child.stderr).includes(secret),false);
});
