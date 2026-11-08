import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from 'pg';
import { CatalogRepository } from '../src/modules/catalog/catalog.repository.js';
import { normalizeSearchFilters } from '../src/modules/catalog/search-contract.js';
import type { DatabasePool } from '../src/platform/database/database.pool.js';

test('public catalog search composes profession and city filters and hides unpublished sellers', async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query('BEGIN');

  try {
    const cities = await db.query<{ id: string; name: string }>(
      "SELECT id::text, name FROM cities WHERE name IN ('Astana', 'Almaty')",
    );
    const astana = cities.rows.find((city) => city.name === 'Astana');
    const almaty = cities.rows.find((city) => city.name === 'Almaty');
    assert.ok(astana, 'CI geography seed must include Astana');
    assert.ok(almaty, 'CI geography seed must include Almaty');

    const suffix = randomUUID();
    const userId = randomUUID();
    const personId = randomUUID();
    const professionId = randomUUID();
    const hiddenProfessionId = randomUUID();
    const serviceId = randomUUID();
    const hiddenServiceId = randomUUID();
    const professionalId = randomUUID();
    const pausedProfessionalId = randomUUID();
    const organizationId = randomUUID();
    const suspendedOrganizationId = randomUUID();

    await db.query('INSERT INTO users(id) VALUES($1)', [userId]);
    await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)', [personId, userId]);
    await db.query(
      'INSERT INTO professions(id,code,name) VALUES($1,$2,$3),($4,$5,$6)',
      [professionId, 'catalog-visible-' + suffix, 'Visible profession',
       hiddenProfessionId, 'catalog-hidden-' + suffix, 'Hidden profession'],
    );
    await db.query(
      'INSERT INTO service_definitions(id,code,name) VALUES($1,$2,$3),($4,$5,$6)',
      [serviceId, 'catalog-service-' + suffix, 'Published service',
       hiddenServiceId, 'catalog-hidden-service-' + suffix, 'Hidden service'],
    );
    await db.query(
      'INSERT INTO profession_services(profession_id,service_id) VALUES($1,$2),($3,$4)',
      [professionId, serviceId, hiddenProfessionId, hiddenServiceId],
    );
    await db.query(
      `INSERT INTO professional_profiles(id,person_id,profession_id,slug,status,title)
       VALUES($1,$2,$3,$4,'PUBLISHED','Visible specialist'),
             ($5,$2,$6,$7,'PAUSED','Paused specialist')`,
      [professionalId, personId, professionId, 'catalog-visible-' + suffix,
       pausedProfessionalId, hiddenProfessionId, 'catalog-paused-' + suffix],
    );
    await db.query(
      `INSERT INTO organizations(id,owner_person_id,slug,name,status)
       VALUES($1,$2,$3,'Visible organization','ACTIVE'),
             ($4,$2,$5,'Suspended organization','SUSPENDED')`,
      [organizationId, personId, 'catalog-org-' + suffix,
       suspendedOrganizationId, 'catalog-suspended-org-' + suffix],
    );

    const visibleOfferId = randomUUID();
    const pausedSellerOfferId = randomUUID();
    const draftOfferId = randomUUID();
    const organizationOfferId = randomUUID();
    const suspendedOrganizationOfferId = randomUUID();
    const otherCityOfferId = randomUUID();
    const privateContact = 'private-contact-' + suffix;
    await db.query(
      `INSERT INTO service_offers(
         id,definition_id,professional_id,organization_id,city_id,title,status,delivery_mode,contacts
       ) VALUES
         ($1,$2,$3,NULL,$4,'Visible Astana service','PUBLISHED','online',jsonb_build_object('private',$10::text)),
         ($5,$6,$7,NULL,$4,'Paused seller service','PUBLISHED','online','{}'::jsonb),
         ($8,$2,$3,NULL,$4,'Draft service','DRAFT','online','{}'::jsonb),
         ($9,$2,NULL,$11,$4,'Organization Astana service','PUBLISHED','online','{}'::jsonb),
         ($12,$2,NULL,$13,$4,'Suspended organization service','PUBLISHED','online','{}'::jsonb),
         ($14,$2,$3,NULL,$15,'Visible Almaty service','PUBLISHED','online','{}'::jsonb)`,
      [visibleOfferId, serviceId, professionalId, astana.id,
       pausedSellerOfferId, hiddenServiceId, pausedProfessionalId, draftOfferId,
       organizationOfferId, privateContact, organizationId,
       suspendedOrganizationOfferId, suspendedOrganizationId, otherCityOfferId, almaty.id],
    );

    const draftSellerUserId = randomUUID();
    const draftSellerPersonId = randomUUID();
    const draftProfessionalId = randomUUID();
    const draftProfileOfferId = randomUUID();
    await db.query('INSERT INTO users(id) VALUES($1)', [draftSellerUserId]);
    await db.query('INSERT INTO persons(id,user_id) VALUES($1,$2)',
      [draftSellerPersonId, draftSellerUserId]);
    await db.query(
      `INSERT INTO professional_profiles(id,person_id,profession_id,slug,status,title)
       VALUES($1,$2,$3,$4,'DRAFT','Draft specialist')`,
      [draftProfessionalId, draftSellerPersonId, professionId,
       'catalog-draft-' + suffix],
    );
    await db.query(
      `INSERT INTO service_offers(
         id,definition_id,professional_id,city_id,title,status,delivery_mode,contacts
       ) VALUES($1,$2,$3,$4,'Published offer for draft profile','PUBLISHED','online','{}'::jsonb)`,
      [draftProfileOfferId, serviceId, draftProfessionalId, astana.id],
    );

    const repo = new CatalogRepository(db as unknown as DatabasePool);
    const result = await repo.search(normalizeSearchFilters({
      scope: 'city',
      city_id: astana.id,
      profession_id: professionId,
    }));

    assert.deepEqual(
      result.items.map(({ kind, id }) => kind + ':' + id).sort(),
      [
        'offer:' + visibleOfferId,
        'offer:' + organizationOfferId,
        'professional:' + professionalId,
        'organization:' + organizationId,
      ].sort(),
    );
    assert.doesNotMatch(JSON.stringify(result), new RegExp(privateContact));
    assert.equal(result.items.find((item) => item.kind === 'professional')?.slug,
      'catalog-visible-' + suffix);

    const textResult = await repo.search(normalizeSearchFilters({
      scope: 'city',
      city_id: astana.id,
      profession_id: professionId,
      q: 'Visible Astana service',
    }));
    assert.deepEqual(textResult.items.map((item) => item.id), [visibleOfferId]);

    const pageOfferIds = Array.from({ length: 52 }, () => randomUUID());
    const pageOfferTitles = Array.from(
      { length: pageOfferIds.length },
      (_, index) => 'Paged service ' + String(index).padStart(2, '0'),
    );
    await db.query(
      `INSERT INTO service_offers(
         id,definition_id,professional_id,city_id,title,status,delivery_mode,contacts
       )
       SELECT page.id::uuid,$1::uuid,$2::uuid,$3::uuid,page.title,
              'PUBLISHED','online','{}'::jsonb
       FROM unnest($4::text[],$5::text[]) AS page(id,title)`,
      [serviceId, professionalId, astana.id, pageOfferIds, pageOfferTitles],
    );
    const pageFilters = {
      kind: 'offer',
      scope: 'city',
      city_id: astana.id,
      profession_id: professionId,
    };
    const firstPage = await repo.search(normalizeSearchFilters(pageFilters));
    assert.equal(firstPage.items.length, 50);
    assert.ok(firstPage.next_cursor);
    const secondPage = await repo.search(normalizeSearchFilters({
      ...pageFilters,
      cursor: firstPage.next_cursor,
    }));
    assert.equal(secondPage.items.length, 4);
    assert.equal(secondPage.next_cursor, null);
    const pageIds = [...firstPage.items, ...secondPage.items].map((item) => item.id);
    assert.equal(new Set(pageIds).size, 54);
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
  }
});
