import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';

test('migrated platform admin identity, session and grant constraints exist',{
  skip:!process.env.DATABASE_URL,timeout:15_000,
},async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:3000});
  try{
    const tables=await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name=ANY($1::text[])
    `,[['platform_admin_staff','platform_admin_sessions','platform_admin_grants']]);
    assert.equal(tables.rows.length,3);
    const constraints=await pool.query(`
      SELECT conname,contype FROM pg_constraint
      WHERE conrelid IN ('public.platform_admin_staff'::regclass,
        'public.platform_admin_sessions'::regclass,
        'public.platform_admin_grants'::regclass)
    `);
    const byName=new Map(constraints.rows.map((r:{conname:string;contype:string})=>[r.conname,r.contype]));
    assert.equal(byName.get('platform_admin_staff_role_check'),'c');
    assert.equal(byName.get('platform_admin_sessions_valid_times'),'c');
    assert.equal(byName.get('platform_admin_sessions_token_hash_format'),'c');
    assert.equal(byName.get('platform_admin_sessions_staff_id_fkey'),'f');
    assert.equal(byName.get('platform_admin_grants_staff_id_fkey'),'f');
    const indexes=await pool.query(`
      SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'
      AND indexname=ANY($1::text[])
    `,[['platform_admin_staff_user_id_key','platform_admin_sessions_token_hash_key',
      'platform_admin_grants_staff_id_scope_key']]);
    assert.equal(indexes.rows.length,3);
    for(const index of indexes.rows)assert.match(index.indexdef,/CREATE UNIQUE INDEX/i);
  }finally{await pool.end();}
});
