import type {PoolClient} from 'pg';
import {
  encodeInboxCursor,
  type SellerInboxFilter,type SellerInboxItem,type SellerInboxPage,
  SELLER_REQUEST_STATES,
} from './seller-inbox.contract.js';

type InboxRow={
  id:string;service_offer_id:string;title:string;
  status:string;version:number;seller_kind:'professional'|'organization';
  seller_id:string;created_at:Date;scheduled_start_at:Date|null;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * SQL owns resource authorization; no account ID, seller ID, contact, note or
 * seller context is accepted from the browser. Personal and company work
 * require distinct ownership/membership grants. AUDITOR/OPERATOR denied.
 */
export async function readSellerInbox(
  client:Pick<PoolClient,'query'>,
  authenticatedUserId:string,
  filter:SellerInboxFilter,
):Promise<SellerInboxPage>{
  if(typeof authenticatedUserId!=='string'||!UUID.test(authenticatedUserId)||
     authenticatedUserId.toLowerCase()==='00000000-0000-0000-0000-000000000000')
    throw new Error('invalid_identity');
  // Defensive boundary for non-HTTP callers that bypass parseSellerInboxFilter.
  if(!filter||typeof filter!=='object'||
     !Number.isSafeInteger(filter.limit)||filter.limit<1||filter.limit>50||
     filter.state===undefined||filter.before===undefined||
     (filter.state!==null&&!(typeof filter.state==='string'&&
       (SELLER_REQUEST_STATES as readonly string[]).includes(filter.state)))||
     (filter.before!==null&&(!filter.before||typeof filter.before!=='object'||
       typeof filter.before.id!=='string'||!UUID.test(filter.before.id)||
       typeof filter.before.createdAt!=='string'||
       !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(filter.before.createdAt)||
       !Number.isFinite(Date.parse(filter.before.createdAt))||
       new Date(filter.before.createdAt).toISOString()!==filter.before.createdAt)))
    throw new Error('invalid_seller_inbox_filter');
  const result=await client.query<InboxRow>(`
    SELECT req.id::text,req.offer_id::text AS service_offer_id,
      offer.title,req.status::text,req.version,
      CASE WHEN req.seller_professional_id IS NOT NULL
        THEN 'professional' ELSE 'organization' END AS seller_kind,
      COALESCE(req.seller_professional_id,req.seller_organization_id)::text AS seller_id,
      req.created_at,req.scheduled_start_at
    FROM service_requests req
    JOIN service_offers offer ON offer.id=req.offer_id
    WHERE
      (req.seller_professional_id IS NULL) <> (req.seller_organization_id IS NULL)
      AND ($2::text IS NULL OR LOWER(req.status::text)=$2::text)
      AND ($3::timestamptz IS NULL OR
           (date_trunc('milliseconds',req.created_at),req.id)<($3::timestamptz,$4::uuid))
      AND (
        (req.seller_professional_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM professional_profiles prof
          JOIN persons owner_person ON owner_person.id=prof.person_id
          JOIN users usr ON usr.id=owner_person.user_id
          WHERE prof.id=req.seller_professional_id
            AND usr.id=$1::uuid AND usr.status='ACTIVE'
            AND prof.status='PUBLISHED'
        ))
        OR
        (req.seller_organization_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM organizations org
          JOIN organization_members member ON member.organization_id=org.id
          JOIN users usr ON usr.id=member.user_id
          WHERE org.id=req.seller_organization_id
            AND org.status='ACTIVE'
            AND usr.id=$1::uuid AND usr.status='ACTIVE'
            AND member.revoked_at IS NULL
            AND member.role IN ('OWNER','ADMIN')
            AND (member.scope IS NULL OR member.scope='{}'::jsonb)
        ))
      )
    ORDER BY date_trunc('milliseconds',req.created_at) DESC,req.id DESC
    LIMIT $5::integer
  `,[authenticatedUserId,filter.state,filter.before?.createdAt??null,
    filter.before?.id??null,filter.limit+1]);
  if(!result||!Array.isArray(result.rows)||result.rows.length>filter.limit+1)
    throw new Error('invalid_seller_inbox_page');
  const hasMore=result.rows.length>filter.limit;
  const rows=result.rows.slice(0,filter.limit);
  const allowedStates:readonly string[]=SELLER_REQUEST_STATES;
  const items:SellerInboxItem[]=rows.map(row=>{
    if(!row||typeof row!=='object')throw new Error('invalid_seller_inbox_row');
    const state=typeof row.status==='string'?row.status.toLowerCase():'';
    if(
       typeof row.id!=='string'||!UUID.test(row.id)||
       typeof row.service_offer_id!=='string'||!UUID.test(row.service_offer_id)||
       typeof row.seller_id!=='string'||!UUID.test(row.seller_id)||
       typeof row.title!=='string'||row.title.length>500||
       (row.seller_kind!=='professional'&&row.seller_kind!=='organization')||
       !allowedStates.includes(state)||!Number.isSafeInteger(row.version)||row.version<1||
       !(row.created_at instanceof Date)||!Number.isFinite(row.created_at.getTime())||
       (row.scheduled_start_at!==null&&
        (!(row.scheduled_start_at instanceof Date)||!Number.isFinite(row.scheduled_start_at.getTime()))))
      throw new Error('invalid_seller_inbox_row');
    return {
    id:row.id,
    service_offer_id:row.service_offer_id,
    title:row.title,
    state:state as SellerInboxItem['state'],
    version:row.version,
    seller_kind:row.seller_kind,
    seller_id:row.seller_id,
    created_at:row.created_at.toISOString(),
    scheduled_start_at:row.scheduled_start_at?.toISOString()??null,
  };});
  if(new Set(items.map(item=>item.id)).size!==items.length)
    throw new Error('invalid_seller_inbox_row');
  const tail=rows[rows.length-1];
  return {items,next_cursor:hasMore&&tail?
    encodeInboxCursor(tail.created_at.toISOString(),tail.id):null};
}
