import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const schema=readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8');
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
  const sql=readFileSync(new URL('../prisma/migrations/'+folder+'/migration.sql',import.meta.url),'utf8');
  assert.ok(sql.includes('CREATE TABLE "'+table+'"'),table+' missing from migration');
  assert.ok(sql.includes('REFERENCES "platform_admin_staff"("id") ON DELETE CASCADE'),
   table+' missing staff foreign key');
 }
});
