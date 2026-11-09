import {Injectable} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {mutateScheduleProposal,type ScheduleProposalAction,type ScheduleProposalCommandResult}
  from './schedule-proposal.transaction.js';
import type {ScheduleProposalInput} from './schedule-proposal.contract.js';

@Injectable()
export class ScheduleProposalHttpService{
  constructor(private readonly db:DatabasePool){}

  mutate(args:{token?:string;requestId:string;action:ScheduleProposalAction;expectedVersion:number;
    guestCapability?:string;key:string;input?:ScheduleProposalInput;proposalId?:string}):Promise<ScheduleProposalCommandResult>{
    const pepper=requireSecret(process.env.ACCOUNT_SESSION_HMAC_KEY);
    const guestPepper=args.guestCapability
      ?requireSecret(process.env.GUEST_REQUEST_HMAC_KEY):undefined;
    return this.db.transaction(client=>mutateScheduleProposal(client,{...args,pepper,guestPepper}));
  }
}
