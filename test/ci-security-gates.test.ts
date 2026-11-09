import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('backend security audit is mandatory and independent from DB integration jobs',()=>{
  const workflow=readFileSync('.github/workflows/ci.yml','utf8');
  const audit=workflow.match(/  dependency-audit:\n([\s\S]*?)(?=\n  build-and-test:)/);
  assert.ok(audit,'separate dependency-audit job required');
  assert.match(audit[1],/npm audit --omit=dev --audit-level=high --json > npm-audit\.json/);
  assert.match(audit[1],/if: \$\{\{ always\(\) \}\}/);
  assert.match(audit[1],/uses: actions\/upload-artifact@v4/);
  assert.match(audit[1],/name: backend-production-npm-audit/);
  assert.doesNotMatch(audit[1],/continue-on-error:\s*true|npm audit[^\n]*\|\|\s*true/);
  assert.match(workflow,/^  build-and-test:\n/m);
  assert.doesNotMatch(workflow,/^    needs:\s*dependency-audit/m,
    'DB integration tests must run even when security audit fails');
});

test('migration drift gate compares generated SQL with committed initial migration',()=>{
  const workflow=readFileSync('.github/workflows/ci.yml','utf8');
  assert.match(workflow,/npm run db:baseline:generate/);
  assert.match(workflow,/git diff --exit-code -- prisma\/migrations\/20261103_initial_platform\/migration\.sql prisma\/migrations\/migration_lock\.toml/);
});
