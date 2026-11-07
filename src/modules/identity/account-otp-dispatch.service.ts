import {ServiceUnavailableException} from '@nestjs/common';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {requireSecret} from '../guest-requests/guest-request.security.js';
import {
  issueAccountOtpChallenge,loadAccountOtpIssuanceSecrets,
  type PrivateAccountOtpDispatch,
} from './account-otp-issuance.js';
import {
  DisabledAccountOtpDelivery,AccountOtpDeliveryUnavailable,
  sanitizeAccountOtpReceipt,type AccountOtpDeliveryPort,
} from './account-otp-delivery.port.js';
import {
  verifyAccountOtpNetworkProof,
} from './account-otp-network-budget.js';
import type {AccountOtpChannel,AccountOtpPurpose} from './account-otp-proof.js';

const UNAVAILABLE='Account verification temporarily unavailable';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type AccountOtpDispatchInput=Readonly<{
  channel:AccountOtpChannel;
  purpose:AccountOtpPurpose;
  contact:unknown;
  locale:'kk'|'ru';
  /** Signed by the trusted ingress; never supplied by client JSON. */
  networkProof:unknown;
}>;
export type AccountOtpDispatchResult=Readonly<{
  challengeId:string;
  expiresInSeconds:number;
}>;

/**
 * PRIVATE orchestration only. Not registered as a public HTTP controller.
 *
 * Challenge+global/network/contact budgets are committed before delivery,
 * and are never refunded when a provider fails. A failed or uncertain
 * provider response revokes the committed challenge. The raw OTP/contact
 * never leaves the trusted process except via the approved provider port.
 */
export class AccountOtpDispatchService {
  constructor(
    private readonly db:Pick<DatabasePool,'transaction'|'query'>,
    private readonly provider:AccountOtpDeliveryPort=new DisabledAccountOtpDelivery(),
  ) {}

  async dispatch(input:AccountOtpDispatchInput):Promise<AccountOtpDispatchResult>{
    if(!input || !['EMAIL','SMS'].includes(input.channel)||
       !['SIGN_IN','SIGN_UP'].includes(input.purpose)||
       !['kk','ru'].includes(input.locale))
      throw new ServiceUnavailableException(UNAVAILABLE);

    let networkDigest:string;
    let secrets:ReturnType<typeof loadAccountOtpIssuanceSecrets>;
    try{
      const attestationKey=requireSecret(process.env.ACCOUNT_NETWORK_ATTESTATION_KEY);
      const digest=verifyAccountOtpNetworkProof(input.networkProof,attestationKey);
      if(!digest)throw new Error('unverified_network');
      networkDigest=digest;
      secrets=loadAccountOtpIssuanceSecrets();
    }catch{
      throw new ServiceUnavailableException(UNAVAILABLE);
    }

    let issued:PrivateAccountOtpDispatch;
    try{
      issued=await this.db.transaction(client=>issueAccountOtpChallenge(
        client,{channel:input.channel,purpose:input.purpose,contact:input.contact,
          networkDigest},secrets));
    }catch{
      throw new ServiceUnavailableException(UNAVAILABLE);
    }

    try{
      const result=await this.provider.deliver({...issued,locale:input.locale});
      const receipt=sanitizeAccountOtpReceipt(result);
      if(!receipt.accepted)throw new AccountOtpDeliveryUnavailable();
    }catch{
      // Do not refund the issuance budget. Deny uncertain/late delivery proof.
      // A database outage may delay revocation; 5-minute TTL and attempt
      // budget remain additional defenses.
      try{
        if(UUID.test(issued.challengeId)){
          await this.db.query(`
            UPDATE account_auth_challenges
               SET consumed_at=now()
             WHERE id=$1::uuid AND consumed_at IS NULL
          `,[issued.challengeId]);
        }
      }catch{/* Do not leak DB/provider internals. */}
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
    // Do not return destination/code or sanitized provider reference.
    return {challengeId:issued.challengeId,expiresInSeconds:issued.expiresInSeconds};
  }
}
