import {Client} from 'pg';
import {
  pruneAccountOtpNetworkLedger,ACCOUNT_OTP_NETWORK_RETENTION,
} from '../src/modules/identity/account-otp-network-cleanup.js';

/**
 * Approved periodic maintenance only. Never run from an API request or at
 * application startup. One bounded batch per invocation; the scheduler can
 * repeat later. Do not log token, contact, network digest or row contents.
 */
async function main():Promise<void>{
  if(process.env.SERVICES_ENABLE_ACCOUNT_NETWORK_CLEANUP!=='enabled')
    throw new Error('Account network cleanup is disabled');
  const uri=process.env.DATABASE_URL;
  if(!uri)throw new Error('Database is not configured');
  const client=new Client({
    connectionString:uri,connectionTimeoutMillis:3500,
    statement_timeout:8000,application_name:'services-account-otp-network-maintenance',
  });
  try{
    await client.connect();
    const count=await pruneAccountOtpNetworkLedger(client);
    console.log('Account OTP network maintenance deleted '+count+
      ' rows; batch limit '+ACCOUNT_OTP_NETWORK_RETENTION.batchLimit);
  }finally{
    await client.end().catch(()=>{});
  }
}
main().catch(()=>{
  console.error('Account OTP network maintenance failed');
  process.exitCode=1;
});
