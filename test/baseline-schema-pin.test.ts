import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

function read(path:string):string{return readFileSync(path,'utf8');}

test('historical baseline is pinned independently from current Prisma model',()=>{
  const historical=read('prisma/baseline.schema.prisma');
  const latest=read('prisma/schema.prisma');
  const generator=read('scripts/generate-baseline.mjs');
  const forward=read('prisma/migrations/20261107_account_otp_delivery_confirmation/migration.sql');
  assert.doesNotMatch(historical,/deliveryConfirmedAt|delivery_confirmed_at/);
  assert.match(latest,/deliveryConfirmedAt\s+DateTime\?/);
  assert.match(forward,/ALTER TABLE account_auth_challenges/);
  assert.match(forward,/ADD COLUMN delivery_confirmed_at TIMESTAMPTZ\(3\)/);
  assert.match(generator,/--to-schema-datamodel','prisma\/baseline\.schema\.prisma/);
  assert.doesNotMatch(generator,/--to-schema-datamodel','prisma\/schema\.prisma/);
});
