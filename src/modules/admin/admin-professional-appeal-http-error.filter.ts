import {ArgumentsHost,Catch,ExceptionFilter,HttpException} from '@nestjs/common';

type ParserError={type?:unknown;status?:unknown;statusCode?:unknown};
type ResponseLike={
 setHeader:(name:string,value:string)=>unknown;
 status:(code:number)=>{json:(value:unknown)=>unknown};
};

/** Optional filter for the prepared private appeal transport, not globally
 * registered. Body-parser errors happen before a controller can check headers.
 * Never expose parser messages, stack traces or request contents.
 */
@Catch()
export class PlatformAppealHttpErrorFilter implements ExceptionFilter{
 catch(error:unknown,host:ArgumentsHost):void{
  const response=host.switchToHttp().getResponse<ResponseLike>();
  const parser=error as ParserError|null;
  const type=parser&&typeof parser.type==='string'?parser.type:null;
  const status=parser&&typeof parser.status==='number'?parser.status:
   parser&&typeof parser.statusCode==='number'?parser.statusCode:null;
  let code:number;
  if(error instanceof HttpException)code=error.getStatus();
  else if(type==='charset.unsupported'||type==='encoding.unsupported')code=415;
  else if(type==='entity.parse.failed')code=400;
  else if(type==='entity.too.large')code=413;
  else if(type==='request.aborted'||type==='request.size.invalid')code=400;
  else code=500;
  // Do not trust a forged status alone: only explicit body-parser types map
  // to 4xx. Unrecognized failures remain generic server errors.
  response.setHeader('Cache-Control','private, no-store, max-age=0');
  response.setHeader('Pragma','no-cache');
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('X-Robots-Tag','noindex, nofollow');
  response.setHeader('Referrer-Policy','no-referrer');
  void status;
  response.status(code).json({statusCode:code,message:code===500?'Internal server error':
   code===415?'Unsupported Media Type':code===413?'Payload Too Large':
   code===400?'Bad Request':code===401?'Unauthorized':code===409?'Conflict':'Request rejected'});
 }
}
