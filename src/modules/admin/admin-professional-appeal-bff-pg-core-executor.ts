import {UnauthorizedException} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {hashAdminSessionToken} from './admin-session-token.js';
import {withAppealBffPgMutationAuthority} from './admin-professional-appeal-bff-pg-mutation-authority.js';
import {assignProfessionalAppealReviewer,type AssignmentReceipt} from './admin-professional-appeal-assignment.js';
import {decideProfessionalAppeal,type AppealReceipt} from './admin-professional-appeal-decision.js';
import type {AppealBffMutation} from './admin-professional-appeal-bff-csrf.js';

type Db=Pick<PoolClient,'query'>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=():never=>{throw new UnauthorizedException('Authentication required');};

/**
 * Verify on the SAME held transaction/connection that the privileged bearer
 * supplied by server custody belongs to this exact browser session's parent.
 * Another live admin session for the same staff does not grant this cookie.
 * The browser must NEVER supply its own admin bearer or parent ID.
 */
export async function assertAppealBffPgParentBearer(
 db:Db,browserSessionId:unknown,bearer:unknown,adminPepper:Buffer,
):Promise<void>{
 if(!db||typeof db.query!=='function'||typeof browserSessionId!=='string'||
  !UUID.test(browserSessionId))return deny();
 let tokenHash:string;
 try{tokenHash=hashAdminSessionToken(bearer,adminPepper);}
 catch{return deny();}
 const result=await db.query<{id:string}>(`
  SELECT browser.id::text AS id
  FROM platform_admin_appeal_browser_sessions browser
  JOIN platform_admin_sessions parent ON parent.id=browser.admin_session_id
    AND parent.staff_id=browser.staff_id
  WHERE browser.id=$1::uuid AND parent.token_hash=$2
    AND browser.revoked_at IS NULL AND browser.expires_at>clock_timestamp()
    AND parent.revoked_at IS NULL AND parent.expires_at>clock_timestamp()
  FOR SHARE OF browser,parent
 `,[browserSessionId,tokenHash]);
 if(!result||!Array.isArray(result.rows)||result.rows.length!==1||
  result.rows[0]?.id!==browserSessionId)return deny();
}

/**
 * Prepared, UNREGISTERED backend executor. The caller must pass an
 * exclusively acquired PostgreSQL client and server-held bearer/pepper.
 * Existing assignment/decision cores remain authoritative for role,
 * reviewer independence, case state, version, immutable audit and transition.
 * This adapter does NOT activate any HTTP route.
 */
export async function executeAppealBffPgCoreMutation(
 db:Db,browserSessionId:unknown,appealId:unknown,action:AppealBffMutation,
 bearer:unknown,adminPepper:Buffer,body:unknown,
):Promise<AssignmentReceipt|AppealReceipt|null>{
 if(action!=='assignment'&&action!=='decision')return deny();
 return withAppealBffPgMutationAuthority(db,browserSessionId,appealId,action,
  async(client)=>{
   await assertAppealBffPgParentBearer(client,browserSessionId,bearer,adminPepper);
   if(action==='assignment')
    return assignProfessionalAppealReviewer(client,bearer,adminPepper,appealId,body);
   return decideProfessionalAppeal(client,bearer,adminPepper,appealId,body);
  });
}
