import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root=process.cwd();
const text=(path:string)=>readFileSync(resolve(root,path),'utf8');

test('KZ staging worker timer is not an automatic GitHub-hosted database cron',()=>{
 const service=text('ops/systemd/services-in-app-worker.service');
 const timer=text('ops/systemd/services-in-app-worker.timer');
 const runbook=text('docs/in-app-worker-staging-runbook.md');
 assert.match(service,/^User=services-worker$/m);
 assert.match(service,/^Group=services-worker$/m);
 assert.match(service,/^Type=oneshot$/m);
 assert.match(service,/^EnvironmentFile=\/etc\/services\/in-app-worker\.env$/m);
 assert.match(service,/^ExecStart=\/usr\/bin\/npm run worker:in-app:once$/m);
 assert.match(service,/^NoNewPrivileges=yes$/m);
 assert.match(service,/^ProtectSystem=strict$/m);
 assert.match(service,/^ProtectHome=yes$/m);
 assert.match(service,/^Restart=no$/m);
 assert.match(service,/^TimeoutStartSec=90$/m);
 assert.match(timer,/^Unit=services-in-app-worker\.service$/m);
 assert.match(timer,/^OnCalendar=\*-\*-\* \*:00\/5:00$/m);
 assert.match(timer,/^Persistent=false$/m);
 assert.doesNotMatch(timer,/^OnBootSec=/m);
 assert.doesNotMatch(service,/^Environment=DATABASE_URL=/m);
 assert.doesNotMatch(service,/--prod|prisma migrate|db:migrate/);
 assert.match(runbook,/NOT DEPLOYED \/ NOT ENABLED/);
 assert.match(runbook,/Kazakhstan-resident/);
 assert.match(runbook,/systemctl disable --now services-in-app-worker.timer/);
 assert.match(runbook,/Staging acceptance is \*\*NOT VERIFIED\*\*/);
});

test('staging scheduler entrypoint remains release-gated and IN_APP only',()=>{
 const runner=text('scripts/process-in-app-notifications.ts');
 const worker=text('src/modules/notifications/in-app-worker.ts');
 const scripts=JSON.parse(text('package.json')) as {scripts:Record<string,string>};
 assert.equal(scripts.scripts['worker:in-app:once'],'tsx scripts/process-in-app-notifications.ts');
 assert.match(runner,/SERVICES_ENABLE_IN_APP_NOTIFICATION_WORKER/);
 assert.match(runner,/!==\s*'enabled'/);
 assert.match(runner,/SERVICES_NOTIFICATION_EXTERNAL_DELIVERY/);
 assert.match(runner,/runOneInAppNotificationBatch\(client,25\)/);
 assert.match(worker,/commitAttempted=true/);
 assert.match(worker,/throw new Error\('In-app notification batch unavailable'\)/);
 assert.doesNotMatch(runner,/sendSms|sendEmail|sendPush|console\.log\(url/);
 const workflow=text('.github/workflows/ci.yml');
 assert.ok(workflow.includes('test/in-app-worker-staging-scheduler.test.ts'));
 assert.doesNotMatch(workflow,/systemctl enable --now services-in-app-worker.timer/);
});

test('KZ staging monitor schedule remains disabled and alerts on both nonzero outcomes',()=>{
 const service=text('ops/systemd/services-in-app-monitor.service');
 const timer=text('ops/systemd/services-in-app-monitor.timer');
 const runbook=text('docs/in-app-worker-staging-runbook.md');
 assert.match(service,/^Type=oneshot$/m);
 assert.match(service,/^User=services-monitor$/m);
 assert.match(service,/^Group=services-monitor$/m);
 assert.match(service,/^EnvironmentFile=\/etc\/services\/in-app-monitor\.env$/m);
 assert.match(service,/^ExecStart=\/usr\/bin\/npm run monitor:in-app:once$/m);
 assert.match(service,/^Restart=no$/m);
 assert.match(service,/^NoNewPrivileges=yes$/m);
 assert.match(service,/^ProtectSystem=strict$/m);
 assert.match(service,/^ProtectHome=yes$/m);
 assert.match(service,/^TimeoutStartSec=30$/m);
 assert.match(timer,/^Unit=services-in-app-monitor\.service$/m);
 assert.match(timer,/^Persistent=false$/m);
 assert.doesNotMatch(timer,/^OnBootSec=/m);
 assert.doesNotMatch(service,/^Environment=DATABASE_URL=/m);
 assert.doesNotMatch(service,/^SuccessExitStatus=/m);
 assert.doesNotMatch(service,/--prod|prisma migrate|db:migrate/);
 assert.match(runbook,/monitor alert receiver/i);
 assert.match(runbook,/systemctl disable --now services-in-app-monitor.timer/);
 const workflow=text('.github/workflows/ci.yml');
 assert.doesNotMatch(workflow,/systemctl enable --now services-in-app-monitor.timer/);
});
