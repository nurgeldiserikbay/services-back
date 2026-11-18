import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BadRequestException} from '@nestjs/common';
import {TaxonomyController} from '../src/modules/catalog/taxonomy.controller.js';
import {TaxonomyRepository} from '../src/modules/catalog/taxonomy.repository.js';
import {parseServiceProfessionId} from '../src/modules/catalog/taxonomy-contract.js';
import type {DatabasePool} from '../src/platform/database/database.pool.js';
const id='11111111-1111-4111-8111-111111111111';
test('optional profession filter rejects malformed and ambiguous input',()=>{
 assert.equal(parseServiceProfessionId(undefined),null);
 assert.equal(parseServiceProfessionId(id),id);
 for(const value of ['',null,{},[id],id+' ', 'invalid'])assert.throws(()=>parseServiceProfessionId(value),BadRequestException);
});
test('service taxonomy is filtered through profession membership with parameterized SQL',async()=>{
 const calls:Array<{sql:string;params:unknown[]}>=[];const rows=[{id,code:'test',name:'Test'}];
 const db={query:async(sql:string,params:unknown[])=>{calls.push({sql,params});return {rows};}} as unknown as DatabasePool;
 const controller=new TaxonomyController(new TaxonomyRepository(db));
 assert.deepEqual(await controller.serviceDefinitions(undefined),rows);
 assert.deepEqual(await controller.serviceDefinitions(id),rows);
 assert.deepEqual(calls.map(c=>c.params),[[null],[id]]);
 assert.match(calls[0].sql,/FROM service_definitions s/);
 assert.match(calls[0].sql,/FROM profession_services ps/);
 assert.match(calls[0].sql,/ps.service_id=s.id AND ps.profession_id=\$1::uuid/);
 assert.throws(()=>controller.serviceDefinitions([id]),BadRequestException);
 assert.equal(calls.length,2);
});
