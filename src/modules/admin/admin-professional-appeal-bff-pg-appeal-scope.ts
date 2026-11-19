import type {PoolClient} from 'pg';
import type {AppealBffMutation} from './admin-professional-appeal-bff-csrf.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Db=Pick<PoolClient,'query'>;
type Row={resource_scope:unknown};

/**
 * Prepared, UNREGISTERED appeal-to-scope resolver.
 * Always derive the scope from the persisted appeal's profile and moderation
 * case, not from a browser body, query parameter or forwarded header.
 * A mismatched case scope/subject is rejected rather than silently granting
 * access to a different profile.
 */
export function createAppealBffPgAppealScopeResolver(db:Db){
 return async(appealId:unknown,action:unknown):Promise<string|null>=>{
  if(!db||typeof db.query!=='function'||typeof appealId!=='string'||
   !UUID.test(appealId)||(action!=='assignment'&&action!=='decision'))return null;
  const result=await db.query<Row>(`
   SELECT moderation.resource_scope
   FROM professional_moderation_appeals AS appeal
   JOIN platform_moderation_cases AS moderation
     ON moderation.id=appeal.case_id
   WHERE appeal.id=$1::uuid
     AND moderation.resource_scope=('professional:' || appeal.profile_id::text)
   LIMIT 2
  `,[appealId]);
  if(!result||!Array.isArray(result.rows)||result.rows.length!==1)return null;
  const scope=result.rows[0]?.resource_scope;
  return typeof scope==='string'&&/^professional:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scope)?
   scope:null;
 };
}
