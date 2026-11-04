import {BadRequestException,UnauthorizedException} from '@nestjs/common';

export const SELLER_REQUEST_STATES = [
  'pending','accepted','declined','cancelled_by_customer',
  'cancelled_by_provider','cancelled_mutual','completed','expired',
] as const;
export type SellerRequestState=(typeof SELLER_REQUEST_STATES)[number];

export type SellerInboxItem={
  id:string;
  service_offer_id:string;
  title:string;
  state:SellerRequestState;
  version:number;
  seller_kind:'professional'|'organization';
  seller_id:string;
  created_at:string;
  scheduled_start_at:string|null;
};

export type SellerInboxPage={
  items:SellerInboxItem[];
  next_cursor:string|null;
};

export type SellerInboxFilter={
  limit:number;
  state:SellerRequestState|null;
  before:{createdAt:string;id:string}|null;
};

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function requireBearerSession(value:unknown):string {
  if(typeof value!=='string')throw new UnauthorizedException('Authentication required');
  const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(value);
  if(!match)throw new UnauthorizedException('Authentication required');
  return match[1];
}

export function encodeInboxCursor(createdAt:string,id:string):string {
  return Buffer.from(JSON.stringify([createdAt,id]),'utf8').toString('base64url');
}
export function parseSellerInboxFilter(input:{limit?:unknown;state?:unknown;cursor?:unknown}):SellerInboxFilter {
  const limitText=input.limit===undefined?'20':input.limit;
  if(typeof limitText!=='string'||!/^(?:[1-9]|[1-4][0-9]|50)$/.test(limitText))
    throw new BadRequestException('Invalid limit');
  const limit=Number(limitText);
  const state=input.state===undefined?null:input.state;
  if(state!==null&&(
    typeof state!=='string'||!(SELLER_REQUEST_STATES as readonly string[]).includes(state)
  ))throw new BadRequestException('Invalid state');
  let before:SellerInboxFilter['before']=null;
  if(input.cursor!==undefined){
    if(typeof input.cursor!=='string'||input.cursor.length>256||
       !/^[A-Za-z0-9_-]+$/.test(input.cursor))
      throw new BadRequestException('Invalid cursor');
    try{
      const text=Buffer.from(input.cursor,'base64url').toString('utf8');
      if(Buffer.from(text,'utf8').toString('base64url')!==input.cursor)
        throw new Error('Noncanonical cursor');
      const tuple:unknown=JSON.parse(text);
      if(!Array.isArray(tuple)||tuple.length!==2||typeof tuple[0]!=='string'||
         typeof tuple[1]!=='string'||!UTC_ISO.test(tuple[0])||
         Number.isNaN(Date.parse(tuple[0]))||!UUID.test(tuple[1]))
        throw new Error('Invalid cursor tuple');
      before={createdAt:tuple[0],id:tuple[1]};
    }catch{
      throw new BadRequestException('Invalid cursor');
    }
  }
  return {limit,state:state as SellerRequestState|null,before};
}
