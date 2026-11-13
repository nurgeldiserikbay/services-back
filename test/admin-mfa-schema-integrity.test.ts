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
 const model=schema.match(/model PlatformAdminSecurityEvent \\{([\\s\\S]*?)\\n\\}/)?.[1];
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
