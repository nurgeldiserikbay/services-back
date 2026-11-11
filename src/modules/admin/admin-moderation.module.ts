import {Module} from '@nestjs/common';
import {PlatformModerationReadController} from './admin-moderation-read.controller.js';
import {PlatformModerationReadService} from './admin-moderation-read.service.js';
import {PlatformAdminLogoutController} from './admin-logout.controller.js';
import {PlatformAdminLogoutService} from './admin-logout.service.js';
@Module({
 controllers:[PlatformModerationReadController,PlatformAdminLogoutController],
 providers:[PlatformModerationReadService,PlatformAdminLogoutService],
})
export class PlatformAdminModerationModule{}
