import {Module} from '@nestjs/common';
import {PersonInboxController} from './person-inbox.controller.js';
import {PersonInboxService} from './person-inbox.service.js';

@Module({
 controllers:[PersonInboxController],
 providers:[PersonInboxService],
})
export class PersonInboxModule {}
