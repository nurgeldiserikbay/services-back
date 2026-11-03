import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabasePool} from '../src/platform/database/database.pool.js';
import {GeographyRepository} from '../src/modules/geography/geography.repository.js';

/** Runs only against a disposable, seeded PostgreSQL database.
 * Never runs against live customer datasets.
 */
test('real PostgreSQL geographic catalog exposes stable IDs and TZ info', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const db=new DatabasePool();
  try {
    const geo=new GeographyRepository(db);
    const countries=await geo.countries();
    const kazakhstan=countries.items.find(country=>country.iso2==='KZ');
    assert.ok(kazakhstan,'starter ISO country must exist');
    const cities=await geo.cities({countryId:kazakhstan.id,areaId:null,q:'Ast'});
    const astana=cities.items.find(city=>city.name==='Astana');
    assert.ok(astana,'starter Astana must be searchable');
    assert.equal(astana.country_id,kazakhstan.id);
    assert.equal(astana.timezone,'Asia/Almaty');
    assert.match(astana.id,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const otherCountry=await geo.cities({countryId:'00000000-0000-4000-8000-000000000001',areaId:null,q:'Ast'});
    assert.deepEqual(otherCountry.items,[]);
  } finally {
    await db.onModuleDestroy();
  }
});
