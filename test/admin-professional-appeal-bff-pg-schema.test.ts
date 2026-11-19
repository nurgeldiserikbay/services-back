import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Client} from 'pg';

/** Read-only verification after Prisma Migrate has applied the committed schema.
 * This does not create, authorize, or delete real administrator sessions.
 */
test('migrated appeal BFF browser session table has separate hash-only schema',{
 skip:!process.env.DATABASE_URL,
},async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  const table=await db.query<{oid:string|null}>(`
   SELECT to_regclass('public.platform_admin_appeal_browser_sessions')::text AS oid
  `);
  assert.equal(table.rows[0]?.oid,'platform_admin_appeal_browser_sessions');
  const columns=await db.query<{column_name:string;data_type:string;is_nullable:string}>(`
   SELECT column_name,data_type,is_nullable
   FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name='platform_admin_appeal_browser_sessions'
  `);
  const map=new Map(columns.rows.map(r=>[r.column_name,r]));
  assert.equal(map.get('id')?.data_type,'uuid');
  assert.equal(map.get('staff_id')?.data_type,'uuid');
  assert.equal(map.get('token_hash')?.data_type,'character');
  assert.equal(map.get('token_hash')?.is_nullable,'NO');
  assert.equal(map.get('expires_at')?.data_type,'timestamp with time zone');
  assert.equal(map.get('revoked_at')?.is_nullable,'YES');
  assert.equal(map.get('created_at')?.is_nullable,'NO');
  assert.equal(map.has('admin_bearer'),false);
  assert.equal(map.has('cookie_token'),false);
  const constraints=await db.query<{contype:string;columns:string}>(`
   SELECT c.contype,
    string_agg(a.attname,',' ORDER BY u.ord) AS columns
   FROM pg_constraint c
   JOIN pg_class t ON t.oid=c.conrelid
   JOIN pg_namespace ns ON ns.oid=t.relnamespace
   JOIN unnest(c.conkey) WITH ORDINALITY u(attnum,ord) ON true
   JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=u.attnum
   WHERE ns.nspname='public' AND t.relname='platform_admin_appeal_browser_sessions'
   GROUP BY c.oid,c.contype
  `);
  assert.ok(constraints.rows.some(r=>r.contype==='p'&&r.columns==='id'));
  assert.ok(constraints.rows.some(r=>r.contype==='f'&&r.columns==='staff_id'));
  const indexes=await db.query<{indexname:string;indexdef:string}>(`
   SELECT indexname,indexdef FROM pg_indexes
   WHERE schemaname='public' AND tablename='platform_admin_appeal_browser_sessions'
  `);
  assert.ok(indexes.rows.some(r=>r.indexname===
   'platform_admin_appeal_browser_sessions_token_hash_key'&&r.indexdef.includes('UNIQUE')));
  assert.ok(indexes.rows.some(r=>r.indexname===
   'platform_admin_appeal_browser_sessions_staff_id_expires_at_idx'));
 }finally{await db.end();}
});
