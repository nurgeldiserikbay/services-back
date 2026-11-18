type RequestLike={method?:string;originalUrl?:string};
type ResponseLike={
 headersSent?:boolean;
 setHeader:(key:string,value:string)=>unknown;
 status:(status:number)=>{json:(body:unknown)=>unknown};
};
type ParserFailure={type?:unknown};
type Next=(error?:unknown)=>void;

/** Express 4-error-argument handler; attach AFTER Nest JSON parser setup
 * with app.init(); app.use(privateAppealParserErrorMiddleware).
 * Prepared/private routes only, never expose raw parser errors.
 */
export function privateAppealParserErrorMiddleware(
 error:unknown,req:RequestLike,res:ResponseLike,next:Next,
):void{
 const path=req.originalUrl?.split('?')[0]??'';
 if(req.method!=='POST'||!/^\/v1\/admin\/moderation\/appeals\/[^/]+\/(?:assignment|decision)\/?$/.test(path)||
   res.headersSent){next(error);return;}
 const t=(error as ParserFailure|null)?.type;
 const code=t==='entity.parse.failed'||t==='request.aborted'||t==='request.size.invalid'?400:
  t==='entity.too.large'?413:
  t==='charset.unsupported'||t==='encoding.unsupported'?415:null;
 if(code===null){next(error);return;}
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('Pragma','no-cache');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Robots-Tag','noindex, nofollow');
 res.setHeader('Referrer-Policy','no-referrer');
 res.status(code).json({statusCode:code,message:code===400?'Bad Request':
  code===413?'Payload Too Large':'Unsupported Media Type'});
}
