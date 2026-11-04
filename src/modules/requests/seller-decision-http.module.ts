import {Module} from '@nestjs/common';
import {SellerDecisionHttpController} from './seller-decision-http.controller.js';
import {SellerDecisionHttpService} from './seller-decision-http.service.js';

@Module({
  controllers:[SellerDecisionHttpController],
  providers:[SellerDecisionHttpService],
})
export class SellerDecisionHttpModule{}
