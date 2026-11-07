import {BadRequestException,Controller,Delete,Get,Header,Headers,HttpCode,Param,Post} from '@nestjs/common';
import {requireBearerSession} from '../requests/seller-inbox.contract.js';
import {AccountBearerSessionService} from './account-bearer-session.service.js';

/**
 * No cookie parsing, browser credentials or client-selected account ID.
 * The web application MUST proxy through a CSRF-protected same-origin BFF.
 * Global CORS deliberately excludes Authorization and POST for browsers.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('auth')
export class AccountBearerSessionController{
  constructor(private readonly sessions:AccountBearerSessionService){}

  @Get('sessions')
  @Header('Cache-Control','private, no-store')
  @Header('Pragma','no-cache')
  list(@Headers('authorization') authorization:unknown){
    return this.sessions.list(requireBearerSession(authorization));
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @Header('Cache-Control','no-store')
  @Header('Pragma','no-cache')
  async revokeSession(
    @Headers('authorization') authorization:unknown,
    @Param('id') targetId:unknown,
  ):Promise<void>{
    const token=requireBearerSession(authorization);
    if(typeof targetId!=='string'||!UUID.test(targetId))
      throw new BadRequestException('Invalid session ID');
    await this.sessions.revokeSession(token,targetId.toLowerCase());
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control','no-store')
  @Header('Pragma','no-cache')
  async logout(@Headers('authorization') authorization:unknown):Promise<void>{
    await this.sessions.logout(requireBearerSession(authorization));
  }
}
