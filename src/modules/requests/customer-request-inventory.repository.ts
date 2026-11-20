import type {PoolClient} from 'pg';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR=/^[A-Za-z0-9_-]{1,180}$/;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export class CustomerRequestInventoryRejected extends Error{
 constructor(){super('invalid_customer_request_cursor');}
}
type Row={id:string;status:string;version:number;created_at:Date};
export type CustomerRequestSummary=Readonly<{
 id:string;state:string;version:number;created_at:string;
}>;
export type CustomerRequestPage=Readonly<{
 items:CustomerRequestSummary[];next_cursor:string|null;
}>;
const STATUSES=new Set(['PENDING','ACCEPTED','DECLINED',
 'CANCELLED_BY_CUSTOMER','CANCELLED_BY_PROVIDER','CANCELLED_MUTUAL',
 'COMPLETED','EXPIRED']);
function readCursor(value:unknown):{at:string;id:string}|null{
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||!CURSOR.test(value))throw new CustomerRequestInventoryRejected();
 try{
  const raw=Buffer.from(value,'base64url');
  if(raw.toString('base64url')!==value||raw.length>128)
   throw new Error('invalid encoding');
  const decoded=JSON.parse(raw.toString('utf8')) as unknown;
  if(!Array.isArray(decoded)||decoded.length!==2||
   typeof decoded[0]!=='string'||!ISO.test(decoded[0])||
   !Number.isFinite(Date.parse(decoded[0]))||
   new Date(decoded[0]).toISOString()!==decoded[0]||
   typeof decoded[1]!=='string'||!UUID.test(decoded[1])||
   decoded[1]!==decoded[1].toLowerCase())throw new Error('invalid content');
  return {at:decoded[0],id:decoded[1]};
 }catch{throw new CustomerRequestInventoryRejected();}
}
const encodeCursor=(at:string,id:string)=>Buffer.from(
 JSON.stringify([at,id]),'utf8').toString('base64url');

/** Authenticated actor MUST be resolved inside the same database transaction. */
export async function listCustomerRequests(
 db:Pick<PoolClient,'query'>,customerPersonId:string,cursor:unknown,
):Promise<CustomerRequestPage>{
 if(typeof customerPersonId!=='string'||!UUID.test(customerPersonId))
  throw new CustomerRequestInventoryRejected();
 const page=readCursor(cursor);
 const result=await db.query<Row>(`
  SELECT id::text,status::text,version,created_at
  FROM service_requests
  WHERE customer_person_id=$1::uuid
    AND ($2::timestamptz IS NULL OR
      (created_at,id)<($2::timestamptz,$3::uuid))
  ORDER BY created_at DESC,id DESC LIMIT 21
 `,[customerPersonId.toLowerCase(),page?.at??null,page?.id??null]);
 const rows=result.rows;
 const items=rows.slice(0,20).map(row=>{
  if(!UUID.test(row.id)||!STATUSES.has(row.status)||
    !Number.isSafeInteger(row.version)||row.version<1||
    !(row.created_at instanceof Date)||
    !Number.isFinite(row.created_at.getTime()))
   throw new Error('invalid_customer_request_projection');
  return {id:row.id,state:row.status.toLowerCase(),
   version:row.version,created_at:row.created_at.toISOString()};
 });
 const last=items.at(-1);
 return {items,next_cursor:rows.length>20&&last?
  encodeCursor(last.created_at,last.id):null};
}
