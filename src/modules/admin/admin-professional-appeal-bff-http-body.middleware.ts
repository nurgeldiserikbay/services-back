type RequestLike={method?:string;originalUrl?:string;
 headers:Record<string,string|string[]|undefined>};
type ResponseLike={
 headersSent?:boolean;
 setHeader:(key:string,value:string)=>unknown;
 status:(code:number)=>{json:(body:unknown)=>unknown};
};
type Next=(error?:unknown)=>void;
const ROUTE=/^\/v1\/admin\/bff\/moderation\/appeals\/[^/]+\/(?:assignment|decision)(?:\/csrf)?\/?$/;
export const APPEAL_BFF_MAX_JSON_BYTES=4096;
function route(req:{method?:string;originalUrl?:string}):boolean{
 return req.method==='POST'&&ROUTE.test(req.originalUrl?.split('?')[0]??'');
}
function reject(res:ResponseLike,status:number,message:string){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('Pragma','no-cache');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Robots-Tag','noindex, nofollow');
 res.setHeader('Referrer-Policy','no-referrer');
 res.status(status).json({statusCode:status,message});
}
/**
 * Unregistered pre-parser BFF boundary: must run BEFORE the JSON parser.
 * Reject compressed bodies and oversize Content-Length without reading the
 * stream. The JSON parser MUST separately enforce a 4096-byte hard limit
 * against missing/forged Content-Length or chunked requests.
 */
export function appealBffHttpBodyPreflight(req:RequestLike,res:ResponseLike,next:Next):void{
 if(!route(req)){next();return;}
 const encoding=req.headers['content-encoding'];
 if(encoding!==undefined&&(typeof encoding!=='string'||encoding.toLowerCase()!=='identity')){
  reject(res,415,'Unsupported Media Type');return;
 }
 const length=req.headers['content-length'];
 if(length!==undefined){
  if(typeof length!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(length)||
   length.length>15){reject(res,400,'Bad Request');return;}
  if(Number(length)>APPEAL_BFF_MAX_JSON_BYTES){
   reject(res,413,'Payload Too Large');return;
  }
 }
 const type=req.headers['content-type'];
 if(typeof type!=='string'||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(type)){
  reject(res,415,'Unsupported Media Type');return;
 }
 next();
}
/** Attach after a route-scoped Express JSON parser (4096-byte limit).
 * This handles only recognized parser failures, never arbitrary exceptions.
 */
export function appealBffHttpParserError(
 error:unknown,req:RequestLike,res:ResponseLike,next:Next,
):void{
 if(!route(req)||res.headersSent){next(error);return;}
 const type=(error as {type?:unknown}|null)?.type;
 const status=type==='entity.too.large'?413:
  type==='charset.unsupported'||type==='encoding.unsupported'?415:
  type==='entity.parse.failed'||type==='request.aborted'||type==='request.size.invalid'?400:null;
 if(status===null){next(error);return;}
 reject(res,status,status===413?'Payload Too Large':
  status===415?'Unsupported Media Type':'Bad Request');
}
