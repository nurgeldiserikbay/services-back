import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {checkContactSendQuota,type ContactSendQuotaResult} from './guest-contact-quota.js';
import {checkGlobalSendQuota,type GlobalSendQuotaResult} from './guest-global-quota.js';
import {checkNetworkSendQuota,recordNetworkSend,type NetworkQuotaResult}
  from './guest-network-quota.js';
import {
  GUEST_OTP_POLICY,contactDigest,encryptGuestContact,makeOtpChallenge,
  normalizeGuestContact,requireSecret,type ContactChannel,
} from './guest-request.security.js';

export type GuestOtpIssuance = Readonly<{
  challengeId:string;
  code:string; // PRIVATE: never return from a public controller
  channel:ContactChannel;
  contact:string; // PRIVATE: only pass to an approved delivery adapter
  expiresInSeconds:number;
}>;

export class GuestOtpSendLimited extends Error {
  constructor(readonly reason:Exclude<ContactSendQuotaResult['reason']|NetworkQuotaResult['reason']|'global_minute'|'global_hourly'|'global_daily','ok'>,
              readonly retryAfterSeconds:number){
    super('Guest OTP temporarily unavailable');
  }
}

/**
 * Atomic internal issuance only. Do not expose as HTTP: network
 * budgets, verified provider delivery and BFF/CSRF must gate public use.
 * Contact encryption and keyed digest are separate from OTP code hashes.
 */
@Injectable()
export class GuestChallengeIssuanceService {
  constructor(private readonly db:DatabasePool){}

  async issueCreateRequest(channel:ContactChannel,contact:unknown,networkDigest?:string):Promise<GuestOtpIssuance>{
    let normalized:string;
    try {normalized=normalizeGuestContact(channel,contact);}
    catch {throw new ServiceUnavailableException('Guest OTP temporarily unavailable');}

    let pepper:Buffer,encryptionKey:Buffer;
    try {
      pepper=requireSecret(process.env.GUEST_REQUEST_HMAC_KEY);
      encryptionKey=requireSecret(process.env.GUEST_CONTACT_ENCRYPTION_KEY);
      if(timingSafeEqual(pepper,encryptionKey))throw new Error('shared_keys');
    }catch {throw new ServiceUnavailableException('Guest OTP temporarily unavailable');}

    const digest=contactDigest(channel,normalized,pepper);
    const encrypted=encryptGuestContact(normalized,encryptionKey);
    const challengeId=randomUUID(),contactId=randomUUID();
    const {code,codeHash}=makeOtpChallenge(challengeId,pepper);

    await this.db.transaction(async client=>{
      // All instances acquire global then recipient lock in one transaction.
      // Failed provider delivery does not refund either send budget.
      const global=await checkGlobalSendQuota(client);
      if(!global.allowed)throw new GuestOtpSendLimited(global.reason as Exclude<GlobalSendQuotaResult['reason'],'ok'>,global.retryAfterSeconds);
      if(networkDigest!==undefined){
        const network=await checkNetworkSendQuota(client,networkDigest);
        if(!network.allowed)throw new GuestOtpSendLimited(network.reason,network.retryAfterSeconds);
      }
      const quota=await checkContactSendQuota(client,digest);
      if(!quota.allowed)throw new GuestOtpSendLimited(quota.reason as Exclude<ContactSendQuotaResult['reason'],'ok'>,quota.retryAfterSeconds);

      await client.query(`
        INSERT INTO guest_contacts(id,channel,encrypted_value,digest,expires_at)
        VALUES($1,$2,$3,$4,now()+interval '1 day')`,
        [contactId,channel,encrypted,digest]);
      if(networkDigest!==undefined)await recordNetworkSend(client,networkDigest);
      await client.query(`
        INSERT INTO guest_challenges
          (id,guest_contact_id,code_hash,purpose,expires_at)
        VALUES($1,$2,$3,'CREATE_REQUEST',now()+($4::integer*interval '1 second'))`,
        [challengeId,contactId,codeHash,GUEST_OTP_POLICY.ttlSeconds]);
    });

    return {challengeId,code,channel,contact:normalized,
      expiresInSeconds:GUEST_OTP_POLICY.ttlSeconds};
  }
}
