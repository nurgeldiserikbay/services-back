import type {PoolClient} from 'pg';

/**
 * In-app delivery means the already-persisted notification can be retrieved
 * by a separately authenticated, recipient-scoped inbox. It does NOT mean
 * the recipient read the notification, and does NOT send SMS/email/push.
 */
type DeliveryRow={id:string};
export async function materializeInAppDeliveries(
  client:Pick<PoolClient,'query'>,
  limit=25,
):Promise<number>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)
    throw new RangeError('limit must be between 1 and 50');
  const selected=await client.query<DeliveryRow>(`
    SELECT d.id::text
    FROM notification_deliveries d
    JOIN notification_intents n ON n.id=d.intent_id
    WHERE d.channel='IN_APP'
      AND n.channel='IN_APP'
      AND d.state='PENDING'
      AND n.state='PENDING'
      AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=now())
    ORDER BY d.id
    LIMIT $1
    FOR UPDATE OF d SKIP LOCKED
  `,[limit]);
  const ids=selected.rows.map(x=>x.id);
  if(!ids.length)return 0;
  const delivered=await client.query<{id:string}>(`
    UPDATE notification_deliveries
    SET state='DELIVERED',delivered_at=now(),attempt_count=attempt_count+1,
        next_attempt_at=NULL
    WHERE id=ANY($1::uuid[]) AND state='PENDING'
    RETURNING intent_id::text AS id
  `,[ids]);
  const intentIds=delivered.rows.map(x=>x.id);
  if(intentIds.length){
    await client.query(`
      UPDATE notification_intents
      SET state='DELIVERED',attempts=attempts+1,next_attempt_at=NULL
      WHERE id=ANY($1::uuid[]) AND state='PENDING'
    `,[intentIds]);
  }
  return delivered.rows.length;
}

/**
 * Internal read model: caller must authorize the person before passing their
 * canonical Person UUID. No controller is wired, so there is no anonymous inbox.
 * No guest token, phone, email, notes or owner contact is projected.
 */
export async function readPersonInAppInbox(
  client:Pick<PoolClient,'query'>,
  personId:string,
  limit=30,
):Promise<Array<{id:string;topic:string;subject_id:string;created_at:Date}>>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(personId))
    throw new Error('invalid_person_id');
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)
    throw new RangeError('invalid_limit');
  const result=await client.query<{
    id:string;topic:string;subject_id:string;created_at:Date
  }>(`
    SELECT n.id::text,e.topic,e.subject_id::text,e.created_at
    FROM notification_intents n
    JOIN domain_outbox_events e ON e.id=n.domain_event_id
    JOIN notification_deliveries d ON d.intent_id=n.id AND d.channel='IN_APP'
    WHERE n.recipient_person_id=$1::uuid AND n.channel='IN_APP'
      AND n.state='DELIVERED' AND d.state='DELIVERED'
    ORDER BY e.created_at DESC,n.id DESC LIMIT $2
  `,[personId,limit]);
  return result.rows;
}
