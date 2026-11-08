import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('backend CI prepares PostgreSQL before running DB integration tests',()=>{
 const workflow=readFileSync('.github/workflows/ci.yml','utf8');
 const steps=[
  'run: npm run typecheck',
  'run: npm run build',
  'run: npm run db:validate',
  'run: npm run db:migrate',
  'npm run db:seed:geo',
  'npm run db:smoke',
  'Verify migrated application tables before integration tests',
  'run: npm test',
 ];
 let previous=-1;
 for(const step of steps){
  const position=workflow.indexOf(step);
  assert.notEqual(position,-1,`CI step missing: ${step}`);
  assert.ok(position>previous,`CI step is out of order: ${step}`);
  previous=position;
 }
 assert.equal(workflow.match(/run: npm test/g)?.length,1);
 assert.match(workflow,/^permissions:\n  contents: read$/m);
 assert.match(workflow,/^    timeout-minutes: 25$/m);
 assert.match(workflow,/^concurrency:\n  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true$/m);
 assert.match(workflow,/DATABASE_URL: postgresql:\/\/services:services@127\.0\.0\.1:5432\/services_test/);
 assert.match(workflow,/AS required\(table_name\)/);
 assert.match(workflow,/to_regclass\(format\('public\.%I', required\.table_name\)\)/);
 assert.match(workflow,/DO \$verify\$/);
 assert.match(workflow,/END \$verify\$;/);
 assert.doesNotMatch(workflow,/^\s*DO \$\s*$/m);
 assert.match(workflow,/psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'/);
});
