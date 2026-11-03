import { Injectable } from '@nestjs/common';
import { DatabasePool } from '../../platform/database/database.pool.js';
import { stageNotificationDeliveries, type StageResult } from './outbox-staging.js';

@Injectable()
export class OutboxStagingService {
  constructor(private readonly db:DatabasePool){}

  /** Safe to invoke repeatedly or from concurrent workers; no HTTP route yet. */
  async stageBatch(maxEvents=25):Promise<StageResult>{
    return this.db.transaction(client=>stageNotificationDeliveries(client,maxEvents));
  }
}
