import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stableGeoId,starterGeography} from '../scripts/seed-geography.js';

test('geography IDs are stable v5 UUIDs for canonical entity names',()=>{
  assert.equal(stableGeoId('country:KZ'),stableGeoId('country:KZ'));
  assert.notEqual(stableGeoId('country:KZ'),stableGeoId('city:KZ:astana'));
  assert.match(stableGeoId('country:KZ'),/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('curated city list only includes known KZ timezone entries',()=>{
  assert.deepEqual(starterGeography.countries.map(x=>x.iso2),['KZ']);
  assert.equal(starterGeography.cities.length,3);
  for(const city of starterGeography.cities){
    assert.equal(city.iso2,'KZ');
    assert.equal(city.timezone,'Asia/Almaty');
  }
});
