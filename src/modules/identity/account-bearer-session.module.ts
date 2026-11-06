import {Module} from '@nestjs/common';
import {AccountBearerSessionController} from './account-bearer-session.controller.js';
import {AccountBearerSessionService} from './account-bearer-session.service.js';

@Module({
  controllers:[AccountBearerSessionController],
  providers:[AccountBearerSessionService],
})
export class AccountBearerSessionModule{}
