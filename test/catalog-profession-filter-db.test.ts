import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogRepository } from '../src/modules/catalog/catalog.repository.js';
import { normalizeSearchFilters } from '../src/modules/catalog/search-contract.js';
import { DatabasePool } from '../src/platform/database/database.pool.js';

/** Uses isolated fixtures in a rollback-only transaction against CI PostgreSQL. */
test('profession filter returns only offers mapped to that canonical profession', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const db = new DatabasePool();
  try {
    await db.transaction(async (client) => {
      const marker = `profession-filter-${randomUUID()}`;
      const cityResult = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM cities WHERE name = 'Astana' ORDER BY id LIMIT 1`,
      );
      const cityId = cityResult.rows[0]?.id;
      assert.ok(cityId, 'seeded Astana city must exist');
      const user = randomUUID();
      const person = randomUUID();
      const profession = randomUUID();
      const profile = randomUUID();
      const organization = randomUUID();
      const matchedDefinition = randomUUID();
      const unmatchedDefinition = randomUUID();
      const matchedProfessionalOffer = randomUUID();
      const matchedOrganizationOffer = randomUUID();
      const unmatchedOrganizationOffer = randomUUID();

      await client.query('INSERT INTO users(id) VALUES ($1::uuid)', [user]);
      await client.query(
        'INSERT INTO persons(id, user_id, display_name) VALUES ($1::uuid, $2::uuid, $3)',
        [person, user, marker],
      );
      await client.query('INSERT INTO professions(id, code, name) VALUES ($1::uuid, $2, $3)', [
        profession, marker, marker,
      ]);
      await client.query(
        `INSERT INTO professional_profiles(id, person_id, profession_id, slug, status, title)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'PUBLISHED', $5)`,
        [profile, person, profession, `${marker}-professional`, marker],
      );
      await client.query(
        `INSERT INTO organizations(id, owner_person_id, slug, name, status)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'ACTIVE')`,
        [organization, person, `${marker}-company`, marker],
      );
      await client.query(
        `INSERT INTO service_definitions(id, code, name)
         VALUES ($1::uuid, $2, $3), ($4::uuid, $5, $6)`,
        [matchedDefinition, `${marker}-matched`, marker,
          unmatchedDefinition, `${marker}-unmatched`, marker],
      );
      await client.query(
        'INSERT INTO profession_services(profession_id, service_id) VALUES ($1::uuid, $2::uuid)',
        [profession, matchedDefinition],
      );
      await client.query(
        `INSERT INTO service_offers(id, definition_id, professional_id, organization_id, city_id, title, status, delivery_mode, contacts)
         VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, $4::uuid, $5, 'PUBLISHED', 'online', '{}'::jsonb),
                ($6::uuid, $2::uuid, NULL, $7::uuid, $8::uuid, $9, 'PUBLISHED', 'online', '{}'::jsonb),
                ($10::uuid, $11::uuid, NULL, $7::uuid, $12::uuid, $13, 'PUBLISHED', 'online', '{}'::jsonb)`,
        [matchedProfessionalOffer, matchedDefinition, profile, cityId, `${marker}-offer-profession-match`,
          matchedOrganizationOffer, organization, cityId, `${marker}-offer-company-match`,
          unmatchedOrganizationOffer, unmatchedDefinition, cityId, `${marker}-offer-unmatched`],
      );

      const txDatabase = {
        query: (sql: string, values: readonly unknown[]) => client.query(sql, [...values]),
      } as unknown as DatabasePool;
      const result = await new CatalogRepository(txDatabase).search(
        normalizeSearchFilters({ q: marker, profession_id: profession, scope: 'city', city_id: cityId }),
      );

      const actual: Array<[string, string]> = result.items.map(({ kind, title }) => [kind, title]);
      const expected: Array<[string, string]> = [
        ['offer', `${marker}-offer-profession-match`],
        ['offer', `${marker}-offer-company-match`],
        ['professional', marker],
        ['organization', marker],
      ];
      const sortItems = (items: Array<[string, string]>) => items.sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      );
      assert.deepEqual(sortItems(actual), sortItems(expected));
      assert.ok(result.items.every((item) => !item.title.includes('unmatched')));
    });
  } finally {
    await db.onModuleDestroy();
  }
});
