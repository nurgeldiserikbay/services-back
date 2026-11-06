import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { GeographyModule } from './geography/geography.module.js';
import { DatabaseModule } from '../platform/database/database.module.js';
import { PublicOfferModule } from './offers/public-offer.module.js';
import { SellerDecisionHttpModule } from './requests/seller-decision-http.module.js';
import { SellerInboxModule } from './requests/seller-inbox.module.js';
import { GuestVerificationModule } from './guest-requests/guest-verification.module.js';
import { AccountBearerSessionModule } from './identity/account-bearer-session.module.js';

@Module({ imports: [DatabaseModule, CatalogModule, GeographyModule, PublicOfferModule, SellerInboxModule, SellerDecisionHttpModule, GuestVerificationModule, AccountBearerSessionModule], controllers: [HealthController] })
export class AppModule {}
