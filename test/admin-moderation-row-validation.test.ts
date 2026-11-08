import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateModerationCaseRows} from '../src/modules/admin/admin-moderation-read.service.js';

const id='123e4567-e89b-42d3-a456-426614174000';
const scope='platform:moderation';
const valid=()=>({id,resource_scope:scope,subject_kind:'professional',state:'triage',created_at:new Date('2026-11-08T00:00:00.000Z')});
const allowed=new Set([scope]);

test('accepts a redacted moderation row only in an authorized scope',()=>{
 assert.deepEqual(validateModerationCaseRows([valid()],allowed),[{
  id,subjectKind:'professional',state:'triage',createdAt:'2026-11-08T00:00:00.000Z',
 }]);
 assert.deepEqual(validateModerationCaseRows([],allowed),[]);
});

test('rejects out-of-scope and malformed moderation rows',()=>{
 const bad=[
  {...valid(),resource_scope:'other'},
  {...valid(),id:'not-a-uuid'},
  {...valid(),subject_kind:'secret'},
  {...valid(),state:'unknown'},
  {...valid(),created_at:new Date(NaN)},
  {...valid(),created_at:'2026-11-08'},
  null,
  undefined,
 ];
 for(const row of bad)assert.throws(()=>validateModerationCaseRows([row] as never,allowed),{status:401});
 assert.throws(()=>validateModerationCaseRows(null as never,allowed),{status:401});
});

test('rejects duplicate IDs regardless of UUID letter casing',()=>{
 assert.throws(()=>validateModerationCaseRows([valid(),{...valid(),id:id.toUpperCase()}],allowed));
});

test('enforces 50-row bound before any data is returned',()=>{
 const rows=Array.from({length:51},(_,i)=>({...valid(),id:`123e4567-e89b-42d3-a456-${String(i).padStart(12,'0')}`}));
 assert.throws(()=>validateModerationCaseRows(rows,allowed));
});

test('50 authorized moderation rows are returned in redacted shape without private fields',()=>{
 const rows=Array.from({length:50},(_,i)=>({
  ...valid(),
  id:`123e4567-e89b-42d3-a456-${String(i).padStart(12,'0')}`,
  internal_note:'private-reviewer-note',
  contact_email:'sensitive@example.org',
 }));
 const output=validateModerationCaseRows(rows,allowed);
 assert.equal(output.length,50);
 for(const item of output){
  assert.deepEqual(Object.keys(item).sort(),['createdAt','id','state','subjectKind']);
  assert.equal(JSON.stringify(item).includes('sensitive@example.org'),false);
  assert.equal(JSON.stringify(item).includes('private-reviewer-note'),false);
 }
});
