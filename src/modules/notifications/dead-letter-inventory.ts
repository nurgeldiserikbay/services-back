import type {PoolClient} from 'pg';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FailedExternalDelivery=Readonly<{
 deliveryId:string;
 intentId:string;
 channel:'EMAIL'|'SMS';
 attempts:number;
}>;

/**
 * Internal operational read model for terminal external notification failures.
 * Not an HTTP API and not an authorization boundary. Callers must authenticate
 * and authorize an operator before this function; never expose unscoped results
 * to end users. No guest contacts, message bodies, provider responses or PII.
 *
 * Keyset pagination is stable for the immutable delivery UUID. Only consistent
 * terminal delivery+intent pairs are returned; inconsistent rows need separate
 * database repair, not silent automatic replay.
 */
export async function listFailedExternalDeliveries(
 client:Pick<PoolClient,'query'>,
 limit=25,
 afterId:string|null=null,
):Promise<FailedExternalDelivery[]>{
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)
  throw new RangeError('invalid_dead_letter_limit');
 if(afterId!==null&&(typeof afterId!=='string'||!UUID.test(afterId)))
  throw new Error('invalid_dead_letter_cursor');
 const result=await client.query<{
  delivery_id:string;
  intent_id:string;
  channel:'EMAIL'|'SMS';
  attempt_count:number;
 }>(`
  SELECT d.id::text AS delivery_id,d.intent_id::text AS intent_id,
         d.channel,d.attempt_count
  FROM notification_deliveries d
  JOIN notification_intents n ON n.id=d.intent_id AND n.channel=d.channel
  WHERE d.channel IN ('EMAIL','SMS')
    AND d.state='FAILED' AND n.state='FAILED'
    AND d.attempt_count=n.attempts
    AND d.lease_token IS NULL AND d.lease_expires_at IS NULL
    AND d.next_attempt_at IS NULL AND n.next_attempt_at IS NULL
    AND ($2::uuid IS NULL OR d.id>$2::uuid)
  ORDER BY d.id
  LIMIT $1::integer
 `,[limit,afterId]);
 if(!Array.isArray(result.rows)||result.rows.length>limit)
  throw new Error('invalid_dead_letter_inventory');
 // PostgreSQL orders UUIDs by their canonical byte sequence. Verify the
 // cursor and strictly increasing order at the driver boundary as well: a
 // corrupt/duplicated page must not appear valid to an operator.
 let lastId=afterId?.toLowerCase()??null;
 return result.rows.map(row=>{
  if(!row||typeof row.delivery_id!=='string'||
     typeof row.intent_id!=='string'||
     !UUID.test(row.delivery_id)||!UUID.test(row.intent_id)||
     (row.channel!=='EMAIL'&&row.channel!=='SMS')||
     !Number.isSafeInteger(row.attempt_count)||row.attempt_count<1)
   throw new Error('invalid_dead_letter_inventory');
  const currentId=row.delivery_id.toLowerCase();
  if(lastId!==null&&currentId<=lastId)
   throw new Error('invalid_dead_letter_inventory');
  lastId=currentId;
  return {
   deliveryId:row.delivery_id,intentId:row.intent_id,
   channel:row.channel,attempts:row.attempt_count,
  };
 });
}
