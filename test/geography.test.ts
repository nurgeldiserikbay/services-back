import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCityFilters,parseUuid} from '../src/modules/geography/geo-contract.js';

test('geography validates canonical UUIDs',()=>{
  assert.equal(parseUuid('0fd94272-7f15-4cbe-a1a9-b79678db23ab','country_id',true),'0fd94272-7f15-4cbe-a1a9-b79678db23ab');
  assert.throws(()=>parseUuid('wrong','country_id',true),/Invalid/);
  assert.throws(()=>parseUuid(undefined,'country_id',true),/Missing/);
});
test('global city search must be specific, country search can list cities',()=>{
  assert.throws(()=>parseCityFilters({q:'A'}),/two characters/);
  assert.throws(()=>parseCityFilters({}),/two characters/);
  assert.deepEqual(parseCityFilters({q:'  Алматы  '}),{q:'Алматы',countryId:null,areaId:null});
  const country='0fd94272-7f15-4cbe-a1a9-b79678db23ab';
  assert.deepEqual(parseCityFilters({country_id:country}),{q:'',countryId:country,areaId:null});
});
test('arrays and long city terms rejected',()=>{
  assert.throws(()=>parseCityFilters({q:['a','b']}),/Invalid q/);
  assert.throws(()=>parseCityFilters({q:'a'.repeat(141)}),/length limit/);
});
