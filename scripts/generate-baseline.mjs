import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** Deterministic INITIAL migration from the pinned historical schema + invariants.
 * Future database evolution belongs in timestamped migrations, not baseline rewrites.
 * Run once and COMMIT the resulting SQL after code review. CI must deploy the
 * committed SQL; never generate migrations at application startup.
 */
const target = join('prisma','migrations','20261103_initial_platform');
const command = [
  'node_modules/prisma/build/index.js','migrate','diff',
  '--from-empty','--to-schema-datamodel','prisma/baseline.schema.prisma','--script'
];
const result=spawnSync(process.execPath,command,{encoding:'utf8',maxBuffer:8*1024*1024});
if(result.status!==0 || !result.stdout.includes('CREATE TABLE')){
  console.error('Prisma baseline SQL generation failed; review pinned Prisma CLI and schema');
  process.exit(1);
}
const custom = readFileSync('prisma/constraints.sql','utf8');
const sql='-- GENERATED BASELINE FROM REVIEWED PRISMA SCHEMA; REVIEW BEFORE PRODUCTION.\n'
  + result.stdout + '\n-- Custom transactional invariants (G0 contracts).\n'
  + custom + '\n';
mkdirSync(target,{recursive:true});
writeFileSync(join(target,'migration.sql'),sql);
writeFileSync(join('prisma','migrations','migration_lock.toml'),'provider = "postgresql"\n');
console.log('Baseline migration assembled from pinned schema and custom invariants');
