import {Module} from '@nestjs/common';
import {SellerInboxController} from './seller-inbox.controller.js';
import {SellerInboxService} from './seller-inbox.service.js';

@Module({
  controllers:[SellerInboxController],
  providers:[SellerInboxService],
})
export class SellerInboxModule{}
