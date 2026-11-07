import type {PoolClient} from 'pg';
import {stageNotificationDeliveries} from './outbox-staging.js';
import {materializeInAppDeliveries} from './in-app-materialization.js';

export type InAppPipelineResult=Readonly<{
  outboxEventsVisited:number;
  deliveryRowsStaged:number;
  inAppDeliveriesMaterialized:number;
}>;

/**
 * Internal, transaction-scoped pipeline. Caller MUST wrap the whole function
 * in a PostgreSQL transaction. It never sends SMS, email or push and never
 * marks the global domain outbox event as processed.
 */
export async function processInAppNotificationBatch(
  client:Pick<PoolClient,'query'>,
  limit=25,
):Promise<InAppPipelineResult>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)
    throw new RangeError('invalid_in_app_pipeline_limit');
  const staged=await stageNotificationDeliveries(client,limit);
  const materialized=await materializeInAppDeliveries(client,limit);
  return {
    outboxEventsVisited:staged.eventsVisited,
    deliveryRowsStaged:staged.deliveriesCreated,
    inAppDeliveriesMaterialized:materialized,
  };
}
