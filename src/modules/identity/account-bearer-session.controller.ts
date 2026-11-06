import {Controller,Get,Header,Headers,HttpCode,Post} from '@nestjs/common';
import {requireBearerSession} from '../requests/seller-inbox.contract.js';
import {AccountBearerSessionService} from './account-bearer-session.service.js';

/**
 * No cookie parsing, browser credentials or client-selected account ID.
 * The web application MUST proxy through a CSRF-protected same-origin BFF.
 * Global CORS deliberately excludes Authorization and POST for browsers.
 */
@Controller('auth')
export class AccountBearerSessionController{
  constructor(private readonly sessions:AccountBearerSessionService){}

  @Get('sessions')
  @Header('Cache-Control','private, no-store')
  @Header('Pragma','no-cache')
  list(@Headers('authorization') authorization:unknown){
    return this.sessions.list(requireBearerSession(authorization));
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control','no-store')
  @Header('Pragma','no-cache')
  async logout(@Headers('authorization') authorization:unknown):Promise<void>{
    await this.sessions.logout(requireBearerSession(authorization));
  }
}
