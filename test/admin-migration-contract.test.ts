import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const schema=readFileSync('prisma/schema.prisma','utf8');
const migration=readFileSync(
  'prisma/migrations/20261111_platform_admin_access/migration.sql','utf8',
);

test('platform admin tables are represented in schema and forward migration',()=>{
  for(const table of [
    'platform_admin_staff','platform_admin_sessions',
    'platform_admin_grants','platform_moderation_cases',
  ]){
    assert.ok(schema.includes('@@map("'+table+'")'),table+' missing from schema');
    assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "'+table+'"'),
      table+' missing from migration');
  }
});

test('admin grants and sessions have database-enforced ownership',()=>{
  for(const key of [
    'platform_admin_staff_user_id_fkey',
    'platform_admin_sessions_staff_id_fkey',
    'platform_admin_grants_staff_id_fkey',
  ])assert.ok(migration.includes('ADD CONSTRAINT "'+key+'"'));
  for(const key of [
    'platform_admin_staff_user_id_key',
    'platform_admin_sessions_token_hash_key',
    'platform_admin_grants_staff_id_scope_key',
  ])assert.ok(migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS "'+key+'"'));
});

test('forward-only database checks reject unknown admin roles and moderation states',()=>{
  const checks=readFileSync(
    'prisma/migrations/20261111_platform_admin_domain_checks/migration.sql','utf8',
  );
  for(const name of [
    'platform_admin_staff_role_check',
    'platform_moderation_cases_subject_kind_check',
    'platform_moderation_cases_state_check',
  ])assert.ok(checks.includes('ADD CONSTRAINT "'+name+'"'));
  for(const role of ['owner','admin','operator','auditor'])
    assert.ok(checks.includes("'"+role+"'"));
  for(const state of ['triage','in_review','decision','appeal','closed'])
    assert.ok(checks.includes("'"+state+"'"));
});
