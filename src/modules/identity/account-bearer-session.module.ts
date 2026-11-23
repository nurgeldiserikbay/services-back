import {Module} from '@nestjs/common';
import {AccountBearerSessionController} from './account-bearer-session.controller.js';
import {AccountBearerSessionService} from './account-bearer-session.service.js';

import {AccountMeController} from './account-me.controller.js';
import {AccountCustomerCompletionController} from './account-customer-completion.controller.js';
import {AccountCustomerRequestsController} from './account-customer-requests.controller.js';
import {AccountCustomerRequestCreateController} from './account-customer-request-create.controller.js';

import {AccountProfessionalProfilesController} from './account-professional-profiles.controller.js';

@Module({
  controllers:[AccountBearerSessionController,AccountMeController,AccountProfessionalProfilesController,AccountCustomerCompletionController,AccountCustomerRequestsController,AccountCustomerRequestCreateController],
  providers:[AccountBearerSessionService],
})
export class AccountBearerSessionModule{}
