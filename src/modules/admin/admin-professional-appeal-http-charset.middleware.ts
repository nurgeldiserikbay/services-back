type RequestLike={
 method?:string;
 originalUrl?:string;
 headers:Record<string,string|string[]|undefined>;
};
type ResponseLike={
 setHeader:(key:string,value:string)=>unknown;
 status:(status:number)=>{json:(body:unknown)=>unknown};
};

/** Prepared pre-parser private-route gate; not installed on production app.
 * Must be installed BEFORE Nest body-parser initialization to normalize
 * unsupported JSON charset without leaking parse error detail.
 */
export function privateAppealCharsetPreflight(
 req:RequestLike,res:ResponseLike,next:()=>void,
):void{
 const path=req.originalUrl?.split('?')[0]??'';
 if(req.method!=='POST'||!/^\/v1\/admin\/moderation\/appeals\/[^/]+\/(?:assignment|decision)\/?$/.test(path)){
  next();return;
 }
 const value=req.headers['content-type'];
 if(typeof value==='string'&&/^application\/json\s*;\s*charset\s*=/.test(value.toLowerCase())&&
   !/^application\/json\s*;\s*charset\s*=utf-8$/i.test(value.trim())){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  res.setHeader('Referrer-Policy','no-referrer');
  res.status(415).json({statusCode:415,message:'Unsupported Media Type'});
  return;
 }
 next();
}
