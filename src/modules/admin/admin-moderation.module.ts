import {PlatformProfessionalDecisionController} from './admin-professional-decision.controller.js';
import {PlatformProfessionalDecisionService} from './admin-professional-decision.service.js';
import {Module} from '@nestjs/common';
import {PlatformModerationReadController} from './admin-moderation-read.controller.js';
import {PlatformModerationReadService} from './admin-moderation-read.service.js';
import {PlatformAdminLogoutController} from './admin-logout.controller.js';
import {PlatformAdminLogoutService} from './admin-logout.service.js';
@Module({
 controllers:[PlatformModerationReadController,PlatformAdminLogoutController,PlatformProfessionalDecisionController],
 providers:[PlatformModerationReadService,PlatformAdminLogoutService,PlatformProfessionalDecisionService],
})
export class PlatformAdminModerationModule{}
