import {Module} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {AccountOtpSignInService} from './account-otp-sign-in.service.js';
import {AccountLoginPrivateController} from './account-login-private.controller.js';

@Module({
 controllers:[AccountLoginPrivateController],
 providers:[{
  provide:AccountOtpSignInService,
  inject:[DatabasePool],
  useFactory:(db:DatabasePool)=>new AccountOtpSignInService(db),
 }],
})
export class AccountLoginPrivateModule{}
