import {Module} from '@nestjs/common';
import {AccountBearerSessionController} from './account-bearer-session.controller.js';
import {AccountBearerSessionService} from './account-bearer-session.service.js';

import {AccountMeController} from './account-me.controller.js';

import {AccountProfessionalProfilesController} from './account-professional-profiles.controller.js';

@Module({
  controllers:[AccountBearerSessionController,AccountMeController,AccountProfessionalProfilesController],
  providers:[AccountBearerSessionService],
})
export class AccountBearerSessionModule{}
