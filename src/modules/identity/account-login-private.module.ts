import {Module} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {AccountOtpSignInService} from './account-otp-sign-in.service.js';
import {AccountLoginPrivateController} from './account-login-private.controller.js';
import {AccountOtpDispatchPrivateController} from './account-otp-dispatch-private.controller.js';
import {AccountOtpDispatchService} from './account-otp-dispatch.service.js';

@Module({
 controllers:[AccountLoginPrivateController,AccountOtpDispatchPrivateController],
 providers:[{
  provide:AccountOtpDispatchService,
  inject:[DatabasePool],
  useFactory:(db:DatabasePool)=>new AccountOtpDispatchService(db),
 },{
  provide:AccountOtpSignInService,
  inject:[DatabasePool],
  useFactory:(db:DatabasePool)=>new AccountOtpSignInService(db),
 }],
})
export class AccountLoginPrivateModule{}
