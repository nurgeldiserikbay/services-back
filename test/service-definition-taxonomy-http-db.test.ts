import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {TaxonomyController} from '../src/modules/catalog/taxonomy.controller.js';
import {TaxonomyRepository} from '../src/modules/catalog/taxonomy.repository.js';
import {DatabasePool} from '../src/platform/database/database.pool.js';
test('public service definitions HTTP lists independent taxonomy and exact profession links',async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 const profession=randomUUID(),other=randomUUID(),service=randomUUID(),foreign=randomUUID();
 try{
  await db.connect();await db.query('BEGIN');
  await db.query('INSERT INTO professions(id,code,name) VALUES($1,$2,$2),($3,$4,$4)',[profession,profession,other,other]);
  await db.query('INSERT INTO service_definitions(id,code,name) VALUES($1,$2,$2),($3,$4,$4)',[service,service,foreign,foreign]);
  await db.query('INSERT INTO profession_services(profession_id,service_id) VALUES($1,$2),($3,$4)',[profession,service,other,foreign]);
  @Module({controllers:[TaxonomyController],providers:[TaxonomyRepository,{provide:DatabasePool,useValue:db}]})
  class FixtureModule{}
  app=await NestFactory.create(FixtureModule,{logger:false,abortOnError:false});
  app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');
  const url=(await app.getUrl())+'/v1/service-definitions';
  const filtered=await fetch(url+'?profession_id='+profession);
  assert.equal(filtered.status,200);
  assert.deepEqual(await filtered.json(),[{id:service,code:service,name:service}]);
  const all=await fetch(url);assert.equal(all.status,200);
  const items=await all.json() as Array<{id:string}>;
  assert.ok(items.some(item=>item.id===service));assert.ok(items.some(item=>item.id===foreign));
  assert.equal((await fetch(url+'?profession_id=invalid')).status,400);
  assert.equal((await fetch(url+'?profession_id='+profession+'&profession_id='+other)).status,400);
  const empty=await fetch(url+'?profession_id='+randomUUID());assert.equal(empty.status,200);assert.deepEqual(await empty.json(),[]);
 }finally{try{await app?.close();}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}}
});
