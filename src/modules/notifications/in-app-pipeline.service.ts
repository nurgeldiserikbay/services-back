import {Injectable} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {
  processInAppNotificationBatch,type InAppPipelineResult,
} from './in-app-pipeline.js';

/**
 * Private scheduler integration point only. NOT an HTTP controller and
 * NOT automatically started. Transaction preserves staging/materialization
 * consistency if a write fails.
 */
@Injectable()
export class InAppNotificationPipelineService{
  constructor(private readonly db:DatabasePool){}
  async processBatch(limit=25):Promise<InAppPipelineResult>{
    return this.db.transaction(client=>processInAppNotificationBatch(client,limit));
  }
}
