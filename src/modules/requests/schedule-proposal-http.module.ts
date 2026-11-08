import {Module} from '@nestjs/common';
import {ScheduleProposalHttpController} from './schedule-proposal-http.controller.js';
import {ScheduleProposalHttpService} from './schedule-proposal-http.service.js';

@Module({
  controllers:[ScheduleProposalHttpController],
  providers:[ScheduleProposalHttpService],
})
export class ScheduleProposalHttpModule{}
