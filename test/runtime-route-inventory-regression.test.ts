import 'reflect-metadata';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {AppModule} from '../src/modules/app.module.js';

type ClassType=new (...args:never[])=>object;
type DynamicModule=Readonly<{module:ClassType;imports?:unknown[];controllers?:ClassType[]}>;
const verbs=['GET','POST','PUT','DELETE','PATCH','ALL','OPTIONS','HEAD','SEARCH'];

function normalizePath(value:string):string{
 const parts=value.split('/').filter(Boolean).map(x=>
  x.startsWith(':')?'{'+x.slice(1).replace(/\?$/,'')+'}':x);
 return '/'+parts.join('/');
}

/** Static Nest decorator metadata only: no application boot, sockets or DB. */
function collectControllerDeclarations(root:ClassType):string[]{
 const declarations:string[]=[];
 const visited=new Set<ClassType>();
 const visit=(entry:ClassType|DynamicModule):void=>{
  const module=typeof entry==='function'?entry:entry.module;
  if(visited.has(module))return;
  visited.add(module);
  const controllers=[
   ...((Reflect.getMetadata('controllers',module)??[]) as ClassType[]),
   ...(typeof entry==='function'?[]:entry.controllers??[]),
  ];
  for(const controller of new Set(controllers)){
   const prefix=Reflect.getMetadata('path',controller);
   assert.equal(typeof prefix,'string',
    'Controller path must be a static string: '+controller.name);
   for(const name of Object.getOwnPropertyNames(controller.prototype)){
    if(name==='constructor')continue;
    const handler=(controller.prototype as Record<string,unknown>)[name];
    if(typeof handler!=='function')continue;
    const method=Reflect.getMetadata('method',handler) as number|undefined;
    if(method===undefined)continue;
    const path=Reflect.getMetadata('path',handler);
    assert.equal(typeof path,'string',
     'Route path must be static: '+controller.name+'.'+name);
    assert.ok(Number.isSafeInteger(method)&&method>=0&&method<verbs.length,
     'Unknown HTTP decorator: '+controller.name+'.'+name);
    declarations.push(verbs[method]+' '+normalizePath(prefix+'/'+path));
   }
  }
  const imports=[
   ...((Reflect.getMetadata('imports',module)??[]) as unknown[]),
   ...(typeof entry==='function'?[]:entry.imports??[]),
  ];
  for(const imported of imports){
   if(typeof imported==='function')visit(imported as ClassType);
   else if(imported&&typeof imported==='object'&&
    typeof (imported as DynamicModule).module==='function')
    visit(imported as DynamicModule);
  }
 };
 visit(root);
 return declarations.sort();
}

test('pinned AppModule runtime route inventory matches controller declarations',()=>{
 const snapshot=JSON.parse(readFileSync(resolve(process.cwd(),
  'contracts/runtime-route-inventory.json'),'utf8')) as {
  schemaVersion:number;scope:string;routes:string[];
 };
 assert.equal(snapshot.schemaVersion,1);
 assert.match(snapshot.scope,/static AppModule/);
 assert.deepEqual(snapshot.routes,[...new Set(snapshot.routes)].sort(),
  'Pinned route inventory must be sorted and unique');
 const actual=collectControllerDeclarations(AppModule);
 assert.deepEqual(actual,[...new Set(actual)],
  'Duplicate AppModule HTTP method/path declarations');
 const expected=new Set(snapshot.routes),declared=new Set(actual);
 const missing=actual.filter(x=>!expected.has(x));
 const stale=snapshot.routes.filter(x=>!declared.has(x));
 assert.deepEqual({missing,stale},{missing:[],stale:[]},
  'Backend controller declarations drifted from pinned inventory; review API exposure and update snapshot only after inspection');
});

test('known API design/runtime gaps are explicit and do not silently drift',()=>{
 const pinned=JSON.parse(readFileSync(resolve(process.cwd(),
  'contracts/api-design-gap-baseline.json'),'utf8')) as {
  schemaVersion:number;source:string;scope:string;
  designRoutes:string[];knownDesignOnly:string[];knownRuntimeOnly:string[];
 };
 const runtime=JSON.parse(readFileSync(resolve(process.cwd(),
  'contracts/runtime-route-inventory.json'),'utf8')) as {routes:string[]};
 assert.equal(pinned.schemaVersion,1);
 assert.match(pinned.source,/2026-11-23 source-inspection snapshot/);
 assert.match(pinned.scope,/not HTTP availability/);
 const uniqueSorted=(rows:string[])=>[...new Set(rows)].sort();
 for(const rows of [pinned.designRoutes,pinned.knownDesignOnly,pinned.knownRuntimeOnly]){
  assert.deepEqual(rows,uniqueSorted(rows),
   'API design baseline routes must be sorted and unique');
 }
 // Snapshot remains deliberately unresolved; passing does not mean API parity.
 assert.equal(pinned.designRoutes.length,65);
 assert.equal(runtime.routes.length,46);
 const design=new Set(pinned.designRoutes),implemented=new Set(runtime.routes);
 const missingImplementation=pinned.designRoutes.filter(x=>!implemented.has(x));
 const runtimeNotInDesign=runtime.routes.filter(x=>!design.has(x));
 assert.deepEqual(missingImplementation,pinned.knownDesignOnly,
  'Design-only operations changed: review implementation and product approval before changing the baseline');
 assert.deepEqual(runtimeNotInDesign,pinned.knownRuntimeOnly,
  'Runtime-only operations changed: review exposure, feature flags and authorization before changing the baseline');
 assert.equal(missingImplementation.length,36);
 assert.equal(runtimeNotInDesign.length,17);
 assert.equal(pinned.designRoutes.length-missingImplementation.length,29);
});
