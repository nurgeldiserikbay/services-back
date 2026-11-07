import {Module} from '@nestjs/common';
import {PlatformModerationReadController} from './admin-moderation-read.controller.js';
import {PlatformModerationReadService} from './admin-moderation-read.service.js';
@Module({
 controllers:[PlatformModerationReadController],
 providers:[PlatformModerationReadService],
})
export class PlatformAdminModerationModule{}
