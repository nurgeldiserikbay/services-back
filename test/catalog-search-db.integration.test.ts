import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogRepository } from '../src/modules/catalog/catalog.repository.js';
import { normalizeSearchFilters } from '../src/modules/catalog/search-contract.js';
import { DatabasePool } from '../src/platform/database/database.pool.js';

/** Uses a rollback-only transaction in the disposable CI PostgreSQL database. */
test('PostgreSQL catalog search exposes published sellers and hides unpublished sellers', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const db = new DatabasePool();
  try {
    await db.transaction(async (client) => {
      const marker = `catalog-${randomUUID()}`;
      const userPublished = randomUUID();
      const userHidden = randomUUID();
      const personPublished = randomUUID();
      const personHidden = randomUUID();
      const profession = randomUUID();
      const profilePublished = randomUUID();
      const profileDraft = randomUUID();
      const organizationActive = randomUUID();
      const organizationSuspended = randomUUID();
      const definition = randomUUID();
      const offerProfessionalPublished = randomUUID();
      const offerProfessionalDraft = randomUUID();
      const offerOrganizationActive = randomUUID();
      const offerOrganizationSuspended = randomUUID();

      await client.query('INSERT INTO users(id) VALUES ($1::uuid), ($2::uuid)', [userPublished, userHidden]);
      await client.query(
        'INSERT INTO persons(id, user_id, display_name) VALUES ($1::uuid, $2::uuid, $3), ($4::uuid, $5::uuid, $6)',
        [personPublished, userPublished, marker, personHidden, userHidden, marker],
      );
      await client.query(
        'INSERT INTO professions(id, code, name) VALUES ($1::uuid, $2, $3)',
        [profession, marker, marker],
      );
      await client.query(
        `INSERT INTO professional_profiles(id, person_id, profession_id, slug, status, title)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'PUBLISHED', $5),
                ($6::uuid, $7::uuid, $3::uuid, $8, 'DRAFT', $9)`,
        [profilePublished, personPublished, profession, `${marker}-published`, marker,
          profileDraft, personHidden, `${marker}-draft`, marker],
      );
      await client.query(
        `INSERT INTO organizations(id, owner_person_id, slug, name, status)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'ACTIVE'),
                ($5::uuid, $2::uuid, $6, $7, 'SUSPENDED')`,
        [organizationActive, personPublished, `${marker}-active`, marker,
          organizationSuspended, `${marker}-suspended`, marker],
      );
      await client.query(
        'INSERT INTO service_definitions(id, code, name) VALUES ($1::uuid, $2, $3)',
        [definition, marker, marker],
      );
      await client.query(
        `INSERT INTO service_offers(id, definition_id, professional_id, organization_id, title, status, delivery_mode, contacts)
         VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, $4, 'PUBLISHED', 'online', '{}'::jsonb),
                ($5::uuid, $2::uuid, $6::uuid, NULL, $7, 'PUBLISHED', 'online', '{}'::jsonb),
                ($8::uuid, $2::uuid, NULL, $9::uuid, $10, 'PUBLISHED', 'online', '{}'::jsonb),
                ($11::uuid, $2::uuid, NULL, $12::uuid, $13, 'PUBLISHED', 'online', '{}'::jsonb)`,
        [offerProfessionalPublished, definition, profilePublished, `${marker}-professional-visible`,
          offerProfessionalDraft, profileDraft, `${marker}-professional-hidden`,
          offerOrganizationActive, organizationActive, `${marker}-organization-visible`,
          offerOrganizationSuspended, organizationSuspended, `${marker}-organization-hidden`],
      );

      const txDatabase = {
        query: (sql: string, values: readonly unknown[]) => client.query(sql, [...values]),
      } as unknown as DatabasePool;
      const result = await new CatalogRepository(txDatabase).search(
        normalizeSearchFilters({ q: marker }),
      );

      assert.equal(result.next_cursor, null);
      const actual: Array<[string, string]> = result.items.map(({ kind, title }) => [kind, title]);
      const expected: Array<[string, string]> = [
        ['offer', `${marker}-organization-visible`],
        ['offer', `${marker}-professional-visible`],
        ['organization', marker],
        ['professional', marker],
      ];
      const sortItems = (items: Array<[string, string]>) => items.sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      );
      assert.deepEqual(sortItems(actual), sortItems(expected));
      assert.ok(result.items.every((item) => !item.title.includes('hidden')));
      assert.ok(result.items.every((item) => item.kind !== 'professional' || item.slug === `${marker}-published`));
    });
  } finally {
    await db.onModuleDestroy();
  }
});
