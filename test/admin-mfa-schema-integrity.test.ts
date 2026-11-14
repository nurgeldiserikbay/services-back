import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const schema=readFileSync('prisma/schema.prisma','utf8');
const migrations=[
 ['PlatformAdminTotpReplay','platform_admin_totp_replay','20261113140000_platform_admin_totp_replay'],
 ['PlatformAdminMfaAttempts','platform_admin_mfa_attempts','20261113150000_platform_admin_mfa_attempts'],
 ['PlatformAdminTotpFactor','platform_admin_totp_factors','20261113160000_platform_admin_totp_factors'],
] as const;

test('Prisma declares every privileged MFA table created by migrations',()=>{
 for(const [model,table,folder] of migrations){
  const block=schema.match(new RegExp('model '+model+' \\{([\\s\\S]*?)\\n\\}'))?.[1];
  assert.ok(block,model+' missing from Prisma schema');
  assert.ok(block.includes('@@map("'+table+'")'),model+' maps to wrong table');
  assert.ok(block.includes('staff PlatformAdminStaff @relation('),
   model+' missing staff relation');
  assert.ok(block.includes('onDelete: Cascade'),model+' missing cascade');
  const sql=readFileSync('prisma/migrations/'+folder+'/migration.sql','utf8');
  assert.ok(sql.includes('CREATE TABLE "'+table+'"'),table+' missing from migration');
  assert.ok(sql.includes('REFERENCES "platform_admin_staff"("id") ON DELETE CASCADE'),
   table+' missing staff foreign key');
 }
});

test('privileged security audit model and migration stay aligned',()=>{
 const model=schema.split('model PlatformAdminSecurityEvent {')[1]?.split('\n}')[0];
 assert.ok(model,'security audit model missing');
 assert.ok(model.includes('@@map("platform_admin_security_events")'));
 assert.ok(model.includes('SecurityEventActor'));
 assert.ok(model.includes('SecurityEventTarget'));
 const sql=readFileSync(
  'prisma/migrations/20261113170000_platform_admin_security_events/migration.sql','utf8',
 );
 assert.ok(sql.includes('CREATE TABLE "platform_admin_security_events"'));
 assert.ok(sql.includes("'totp_factor_revoked'"));
 assert.ok(sql.includes('ON DELETE RESTRICT'));
});

test('security audit append-only migration blocks updates and deletes',()=>{
 const sql=readFileSync(
  'prisma/migrations/20261113180000_platform_admin_security_events_append_only/migration.sql',
  'utf8',
 );
 assert.ok(sql.includes('BEFORE UPDATE OR DELETE ON "platform_admin_security_events"'));
 assert.ok(sql.includes('RAISE EXCEPTION'));
 assert.ok(sql.includes('CREATE TRIGGER "platform_admin_security_events_append_only"'));
 assert.match(sql,/ERRCODE\s*=\s*'55000'/);
});


test('MFA audit action migration matches the server-side event allowlist',()=>{
 const sql=readFileSync(
  'prisma/migrations/20261114163000_platform_admin_mfa_audit_actions/migration.sql','utf8',
 );
 const source=readFileSync('src/modules/admin/admin-mfa-security-audit.ts','utf8');
 for(const action of [
  'totp_factor_revoked',
  'totp_factor_activated',
  'totp_activation_failed',
  'admin_mfa_login_succeeded',
  'admin_mfa_login_failed',
 ]){
  assert.ok(sql.includes("'"+action+"'"),action+' missing from database constraint');
  if(action!=='totp_factor_revoked')
   assert.ok(source.includes("'"+action+"'"),action+' missing from audit writer');
 }
 assert.ok(sql.includes('DROP CONSTRAINT "platform_admin_security_events_action_allowed"'));
 assert.ok(sql.includes('ADD CONSTRAINT "platform_admin_security_events_action_allowed"'));
});
