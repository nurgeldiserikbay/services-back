import {ServiceUnavailableException} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {loadAccountOtpIssuanceSecrets} from './account-otp-issuance.js';
import {
  signInWithVerifiedAccountOtp,type PrivateAccountSignIn,
} from './account-otp-sign-in.js';
import type {AccountOtpChannel} from './account-otp-proof.js';

export type AccountSignInAttempt=Readonly<{
  challengeId:unknown;
  channel:AccountOtpChannel;
  code:unknown;
}>;
type Secrets=Readonly<{
  otpPepper:Buffer;contactPepper:Buffer;contactKey:Buffer;sessionPepper:Buffer;
}>;
type TransactionRunner={
  transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>;
};
const UNAVAILABLE='Account sign-in temporarily unavailable';

/**
 * Internal integration boundary, NOT an HTTP endpoint.
 *
 * Important: false verification attempts and valid OTPs for nonexistent/
 * suspended accounts return null, NOT a thrown auth exception, so the
 * transaction commits challenge attempt counters and consumed proofs.
 * SQL/provider errors do throw and the transaction must rollback.
 *
 * Only a trusted server-side consumer can receive the private session token.
 */
export class AccountOtpSignInService{
  constructor(
    private readonly db:TransactionRunner,
    private readonly loadSecrets:()=>Secrets=loadSignInSecrets,
  ){}

  async signIn(attempt:AccountSignInAttempt):Promise<PrivateAccountSignIn|null>{
    if(!attempt||!['EMAIL','SMS'].includes(attempt.channel)||
       typeof attempt.challengeId!=='string'||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attempt.challengeId)||
       typeof attempt.code!=='string'||!/^[0-9]{6}$/.test(attempt.code))
      return null;

    try{
      const secrets=this.loadSecrets();
      return await this.db.transaction(client=>
        signInWithVerifiedAccountOtp(client,attempt,secrets));
    }catch{
      // Never expose user existence, contact, provider or driver details.
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }
}

/** Separate configured 256-bit secrets; actual proof validates distinctness. */
export function loadSignInSecrets():Secrets{
  const issuance=loadAccountOtpIssuanceSecrets();
  return {...issuance,sessionPepper:requireSecret(
    process.env.ACCOUNT_SESSION_HMAC_KEY)};
}
