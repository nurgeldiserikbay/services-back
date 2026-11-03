import type { PoolClient } from 'pg';

/**
 * Atomically stages notification intents into persistent delivery records.
 *
 * Does NOT send SMS/email/push, mark delivery as SENT/DELIVERED, or consume
 * domain_outbox_events.processed_at (other subscribers may depend on it).
 * Caller owns BEGIN/COMMIT/ROLLBACK through DatabasePool.transaction().
 */
type OutboxEventRow={id:string};
type DeliveryRow={id:string};

export type StageResult={
  eventsVisited:number;
  deliveriesCreated:number;
};

export async function stageNotificationDeliveries(
  client:Pick<PoolClient,'query'>,
  maxEvents=25,
):Promise<StageResult>{
  if (!Number.isSafeInteger(maxEvents) || maxEvents<1 || maxEvents>50)
    throw new RangeError('maxEvents must be between 1 and 50');

  // Lock only events with a notification intent still missing its durable
  // delivery row. SKIP LOCKED allows multiple workers without collisions.
  const events=await client.query<OutboxEventRow>(`
    SELECT e.id::text
    FROM domain_outbox_events e
    WHERE EXISTS (
      SELECT 1 FROM notification_intents n
      WHERE n.domain_event_id=e.id AND NOT EXISTS (
        SELECT 1 FROM notification_deliveries d
        WHERE d.intent_id=n.id AND d.channel=n.channel
      )
    )
    ORDER BY e.created_at,e.id
    LIMIT $1::integer
    FOR UPDATE OF e SKIP LOCKED
  `,[maxEvents]);

  const ids=events.rows.map(x=>x.id);
  if(ids.length===0)return {eventsVisited:0,deliveriesCreated:0};

  // Persist PENDING only; consumers must do the actual delivery with their
  // own retry/claim semantics, budget and idempotency. No raw PII is copied.
  const deliveries=await client.query<DeliveryRow>(`
    INSERT INTO notification_deliveries
      (id,intent_id,channel,state,attempt_count)
    SELECT gen_random_uuid(), n.id, n.channel, 'PENDING', 0
    FROM notification_intents n
    WHERE n.domain_event_id=ANY($1::uuid[])
    ON CONFLICT (intent_id,channel) DO NOTHING
    RETURNING id::text
  `,[ids]);
  return {eventsVisited:ids.length,deliveriesCreated:deliveries.rows.length};
}
