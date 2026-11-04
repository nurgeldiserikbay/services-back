import {Client} from 'pg';
import {pruneGuestOtpNetworkLedger,NETWORK_RETENTION}
  from '../src/modules/guest-requests/guest-network-cleanup.js';

/**
 * Run from an approved, authenticated maintenance job, not in API startup.
 * One bounded batch per invocation keeps DB load predictable.
 * The scheduler may repeat until fewer than batchLimit rows are deleted.
 * Never log row contents or a network digest.
 */
async function main():Promise<void>{
  if(process.env.SERVICES_ENABLE_GUEST_NETWORK_CLEANUP!=='enabled')
    throw new Error('Network cleanup is disabled');
  const uri=process.env.DATABASE_URL;
  if(!uri)throw new Error('Database is not configured');
  const client=new Client({connectionString:uri,
    connectionTimeoutMillis:3500,statement_timeout:8000,
    application_name:'services-otp-network-maintenance'});
  try{
    await client.connect();
    const result=await pruneGuestOtpNetworkLedger(client);
    console.log('Network quota maintenance deleted '+result+
      ' rows; batch limit '+NETWORK_RETENTION.batchLimit);
  }finally{
    await client.end().catch(()=>{});
  }
}

main().catch(()=>{
  console.error('Network quota maintenance failed');
  process.exitCode=1;
});
