import type {PoolClient} from 'pg';
import {resolveActiveUserSession} from './session-proof.js';

export type AccountMe=Readonly<{user_id:string;person_id:string}>;

/**
 * Caller owns a single transaction. Identity comes only from the live bearer,
 * never from a request parameter. Optional workspace_ids intentionally omitted
 * until workspace membership semantics and bounds are specified.
 */
export async function readAccountMe(
 db:Pick<PoolClient,'query'>,token:unknown,pepper:Buffer,
):Promise<AccountMe|null>{
 const actor=await resolveActiveUserSession(db,token,pepper);
 if(!actor)return null;
 const result=await db.query<{person_id:string}>(`
  SELECT id::text AS person_id
  FROM persons
  WHERE user_id=$1::uuid
  FOR SHARE
 `,[actor.userId]);
 const person=result.rows[0];
 if(result.rows.length!==1||!person||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(person.person_id))
  return null;
 return {user_id:actor.userId,person_id:person.person_id};
}
