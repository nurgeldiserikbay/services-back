import {Client} from 'pg';
import {
  pruneAccountOtpChallenges,ACCOUNT_OTP_CHALLENGE_RETENTION,
} from '../src/modules/identity/account-otp-challenge-cleanup.js';

/**
 * Explicitly approved maintenance only, never an HTTP route or application
 * startup task. One bounded batch per invocation, no PII in logs.
 */
async function main():Promise<void>{
  if(process.env.SERVICES_ENABLE_ACCOUNT_CHALLENGE_CLEANUP!=='enabled')
    throw new Error('Account challenge cleanup is disabled');
  const connectionString=process.env.DATABASE_URL;
  if(!connectionString)throw new Error('Database not configured');
  const db=new Client({
    connectionString,
    connectionTimeoutMillis:3500,
    statement_timeout:8000,
    application_name:'services-account-challenge-maintenance',
  });
  try{
    await db.connect();
    const deleted=await pruneAccountOtpChallenges(db);
    console.log('Account OTP proof maintenance deleted '+deleted+
      ' rows; batch limit '+ACCOUNT_OTP_CHALLENGE_RETENTION.batchLimit);
  }finally{
    await db.end().catch(()=>{});
  }
}
main().catch(()=>{
  console.error('Account OTP proof maintenance failed');
  process.exitCode=1;
});
