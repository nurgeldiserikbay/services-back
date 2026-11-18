import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {test} from 'node:test';
import ts from 'typescript';

// Static declaration coverage only: never boot Nest, connect a database,
// or infer that a feature-flagged controller is publicly available.
type ReadSource=(file:string)=>string;
const methods=new Set(['Get','Post','Put','Patch','Delete','Head','Options','All','Search']);
function discover(root:string,read:ReadSource){
 const visited=new Set<string>(),controllers=new Set<string>(),routes=new Set<string>();
 const parse=(file:string)=>ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true);
 function decorator(node:ts.Node,name:string){
  if(!ts.canHaveDecorators(node))return undefined;
  return ts.getDecorators(node)?.map(d=>d.expression).find((e):e is ts.CallExpression=>
   ts.isCallExpression(e)&&ts.isIdentifier(e.expression)&&e.expression.text===name);
 }
 function locate(file:string,name:string){
  const src=parse(file);
  const local=src.statements.find((s):s is ts.ClassDeclaration=>ts.isClassDeclaration(s)&&s.name?.text===name);
  if(local)return {file,node:local,src};
  for(const s of src.statements){
   if(!ts.isImportDeclaration(s)||!ts.isStringLiteral(s.moduleSpecifier))continue;
   const bindings=s.importClause?.namedBindings;
   if(!bindings||!ts.isNamedImports(bindings))continue;
   const binding=bindings.elements.find(e=>e.name.text===name);
   if(!binding)continue;
   const spec=s.moduleSpecifier.text;
   assert.ok(spec.startsWith('.')&&spec.endsWith('.js'),'unsupported import: '+spec);
   return locate(resolve(dirname(file),spec.slice(0,-3)+'.ts'),binding.propertyName?.text??name);
  }
  throw Error('unresolved class: '+name+' in '+file);
 }
 function literal(call:ts.CallExpression){
  if(call.arguments.length===0)return '';
  assert.equal(call.arguments.length,1,'unsupported route decorator arguments');
  const arg=call.arguments[0];
  assert.ok(ts.isStringLiteral(arg),'unsupported dynamic route');
  return arg.text;
 }
 function controller(file:string,name:string){
  const c=locate(file,name);
  const key=c.file+':'+c.node.name?.text;
  if(controllers.has(key))return;
  controllers.add(key);
  const prefix=decorator(c.node,'Controller');
  assert.ok(prefix,'missing controller decorator: '+name);
  assert.ok(!c.node.heritageClauses?.length,'unsupported inherited controller');
  for(const member of c.node.members){
   if(!ts.canHaveDecorators(member))continue;
   for(const d of ts.getDecorators(member)??[]){
    const e=d.expression;
    if(!ts.isCallExpression(e)||!ts.isIdentifier(e.expression)||!methods.has(e.expression.text))continue;
    assert.notEqual(e.expression.text,'All','unsupported wildcard method');
    const path='/'+[literal(prefix),literal(e)].map(x=>x.replace(/^\/+|\/+$/g,'')).filter(Boolean).join('/');
    const route=e.expression.text.toUpperCase()+' '+path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g,'{$1}');
    assert.ok(!routes.has(route),'duplicate route: '+route);
    routes.add(route);
   }
  }
 }
 function module(file:string,name:string){
  const c=locate(file,name);
  const key=c.file+':'+c.node.name?.text;
  if(visited.has(key))return;
  visited.add(key);
  const d=decorator(c.node,'Module');
  assert.ok(d&&d.arguments.length===1&&ts.isObjectLiteralExpression(d.arguments[0]),'unsupported module metadata: '+name);
  for(const prop of d.arguments[0].properties){
   assert.ok(ts.isPropertyAssignment(prop),'unsupported module metadata property');
   const field=prop.name.getText(c.src);
   if(field!=='imports'&&field!=='controllers')continue;
   assert.ok(ts.isArrayLiteralExpression(prop.initializer),'unsupported module array: '+field);
   for(const entry of prop.initializer.elements){
    assert.ok(ts.isIdentifier(entry),'unsupported dynamic module entry: '+field);
    if(field==='imports')module(c.file,entry.text);
    else controller(c.file,entry.text);
   }
  }
 }
 module(root,'AppModule');
 return [...routes].sort();
}

function readInventory(file:string):string[]{
 const data:unknown=JSON.parse(readFileSync(file,'utf8'));
 assert.ok(data&&typeof data==='object'&&!Array.isArray(data),'invalid inventory object');
 const record=data as Record<string,unknown>;
 assert.equal(record.schemaVersion,1,'unsupported inventory schema');
 assert.ok(Array.isArray(record.routes),'missing routes');
 const routes:unknown[]=record.routes;
 const result=routes.map(route=>{
  assert.ok(typeof route==='string'&&/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|SEARCH) \/\S*$/.test(route),'invalid route');
  return route;
 });
 assert.equal(new Set(result).size,result.length,'duplicate inventory route');
 assert.ok(result.length>0,'empty inventory');
 return result.sort();
}
const expected=readInventory(resolve('contracts/runtime-route-inventory.json'));

test('AppModule route declarations match reviewed inventory (update docs on intentional drift)',()=>{
 assert.deepEqual(discover(resolve('src/modules/app.module.ts'),f=>readFileSync(f,'utf8')),expected);
});

test('route discovery follows imported modules but excludes unregistered controllers',()=>{
 const root=resolve('fixture/app.ts');
 const files=new Map([
  [root,"import {Feature} from './feature.js'; @Module({imports:[Feature]}) class AppModule {}"],
  [resolve('fixture/feature.ts'),"@Module({controllers:[Visible]}) class Feature {} @Controller('public') class Visible {@Get(':id') read(){}} @Controller('hidden') class Hidden {@Post() write(){}}"],
 ]);
 assert.deepEqual(discover(root,f=>{const s=files.get(f);assert.ok(s);return s;}),['GET /public/{id}']);
});

test('route discovery rejects dynamic path rather than silently overlooking it',()=>{
 const root=resolve('fixture/app.ts');
 assert.throws(()=>discover(root,()=> "@Module({controllers:[C]}) class AppModule {} @Controller(PREFIX) class C {@Get() read(){}}"),/unsupported dynamic route/);
});

test('route discovery rejects dynamic module imports',()=>{
 assert.throws(()=>discover(resolve('fixture/app.ts'),()=> "@Module({imports:[Feature.register()]}) class AppModule {}"),/unsupported dynamic module entry/);
});
