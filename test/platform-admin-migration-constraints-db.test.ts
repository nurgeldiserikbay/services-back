import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';

test('platform admin migration rejects invalid role, orphan grants and malformed session proof',{
  skip:!process.env.DATABASE_URL,timeout:15_000,
},async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:3000});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const userId=randomUUID(),staffId=randomUUID();
    await client.query(`INSERT INTO users (id,status) VALUES ($1,'ACTIVE')`,[userId]);
    await assert.rejects(client.query(`
      INSERT INTO platform_admin_staff (id,user_id,role) VALUES ($1,$2,'superadmin')
    `,[staffId,userId]),{code:'23514'});
    await client.query('ROLLBACK');
    await client.query('BEGIN');
    await assert.rejects(client.query(`
      INSERT INTO platform_admin_grants (id,staff_id,scope) VALUES ($1,$2,$3)
    `,[randomUUID(),randomUUID(),'organization:'+randomUUID()]),{code:'23503'});
    await client.query('ROLLBACK');
    await client.query('BEGIN');
    await client.query(`INSERT INTO users (id,status) VALUES ($1,'ACTIVE')`,[userId]);
    await client.query(`INSERT INTO platform_admin_staff (id,user_id,role)
      VALUES ($1,$2,'auditor')`,[staffId,userId]);
    await assert.rejects(client.query(`
      INSERT INTO platform_admin_sessions
      (id,staff_id,token_hash,mfa_verified_at,expires_at)
      VALUES ($1,$2,$3,now(),now()+interval '1 hour')
    `,[randomUUID(),staffId,'not-a-hash']),{code:'23514'});
    await client.query('ROLLBACK');
  }finally{
    try{await client.query('ROLLBACK');}catch{}
    client.release();await pool.end();
  }
});
