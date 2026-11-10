import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canReadAdminResource} from '../src/modules/admin/admin-read-policy.js';

test('backend admin read policy grants only explicitly listed capabilities',()=>{
  const matrix={
    owner:['moderation.read','audit.read','taxonomy.read'],
    admin:['moderation.read','audit.read','taxonomy.read'],
    operator:['moderation.read','taxonomy.read'],
    auditor:['moderation.read','audit.read','taxonomy.read'],
  } as const;
  const all=['moderation.read','audit.read','taxonomy.read'] as const;
  for(const [role,allowed] of Object.entries(matrix)){
    for(const capability of all){
      assert.equal(canReadAdminResource(role,capability),allowed.includes(capability as never),
        role+': '+capability);
    }
  }
});

test('backend admin read policy denies writes, unknown roles and inherited keys',()=>{
  for(const role of ['owner','admin','operator','auditor']){
    for(const capability of ['moderation.decide','moderation.write','roles.grant',
      'taxonomy.publish','audit.delete','constructor','__proto__']){
      assert.equal(canReadAdminResource(role,capability),false);
    }
  }
  for(const role of ['OWNER','superadmin','constructor','__proto__',null,undefined,{}]){
    assert.equal(canReadAdminResource(role,'audit.read'),false);
  }
  for(const capability of [null,undefined,{},42,'toString']){
    assert.equal(canReadAdminResource('owner',capability),false);
  }
});
