import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {DatabasePool} from '../../platform/database/database.pool.js';
import {checkContactSendQuota,type ContactSendQuotaResult} from './guest-contact-quota.js';
import {checkGlobalSendQuota,type GlobalSendQuotaResult} from './guest-global-quota.js';
import {checkNetworkSendQuota,recordNetworkSend,type NetworkQuotaResult}
  from './guest-network-quota.js';
import {
  GUEST_OTP_POLICY,contactDigest,decryptGuestContact,encryptGuestContact,hashGuestCapability,makeOtpChallenge,
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
        if(!network.allowed)throw new GuestOtpSendLimited(network.reason as Exclude<NetworkQuotaResult['reason'],'ok'>,network.retryAfterSeconds);
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

  /** Reverify the original guest contact using an active READ_CANCEL proof. */
  async issueManageSchedule(
    requestId:unknown,readCapability:unknown,networkDigest:string,
  ):Promise<GuestOtpIssuance|null>{
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const cap=/^[A-Za-z0-9_-]{43}$/;
    if(typeof requestId!=='string'||!uuid.test(requestId)||
       typeof readCapability!=='string'||!cap.test(readCapability)||
       !/^[0-9a-f]{64}$/.test(networkDigest))return null;
    let pepper:Buffer,encryptionKey:Buffer;
    try{
      pepper=requireSecret(process.env.GUEST_REQUEST_HMAC_KEY);
      encryptionKey=requireSecret(process.env.GUEST_CONTACT_ENCRYPTION_KEY);
      if(timingSafeEqual(pepper,encryptionKey))throw new Error('shared_keys');
    }catch{return null;}
    const readHash=hashGuestCapability('READ_CANCEL',readCapability,pepper);
    const challengeId=randomUUID();
    const {code,codeHash}=makeOtpChallenge(challengeId,pepper);
    const result=await this.db.transaction(async client=>{
      const owned=await client.query<{contact_id:string;channel:ContactChannel;
        encrypted_value:string;digest:string}>(`
        SELECT c.id::text AS contact_id,c.channel,c.encrypted_value,c.digest
        FROM service_requests r
        JOIN guest_capabilities cap ON cap.request_id=r.id
          AND cap.guest_contact_id=r.guest_contact_id AND cap.scope='READ_CANCEL'
        JOIN guest_contacts c ON c.id=r.guest_contact_id
        WHERE r.id=$1::uuid AND r.status='ACCEPTED'
          AND cap.token_hash=$2 AND cap.consumed_at IS NULL
          AND cap.expires_at>now() AND c.verified_at IS NOT NULL AND c.expires_at>now()
        FOR UPDATE OF r,c
      `,[requestId.toLowerCase(),readHash]);
      const contact=owned.rows[0];
      if(!contact)return null;
      const global=await checkGlobalSendQuota(client);
      if(!global.allowed)throw new GuestOtpSendLimited(global.reason as Exclude<GlobalSendQuotaResult['reason'],'ok'>,global.retryAfterSeconds);
      const network=await checkNetworkSendQuota(client,networkDigest);
      if(!network.allowed)throw new GuestOtpSendLimited(network.reason as Exclude<NetworkQuotaResult['reason'],'ok'>,network.retryAfterSeconds);
      const quota=await checkContactSendQuota(client,contact.digest);
      if(!quota.allowed)throw new GuestOtpSendLimited(quota.reason as Exclude<ContactSendQuotaResult['reason'],'ok'>,quota.retryAfterSeconds);
      await recordNetworkSend(client,networkDigest,'MANAGE_SCHEDULE');
      await client.query(`
        INSERT INTO guest_challenges(id,guest_contact_id,request_id,code_hash,purpose,expires_at)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4,'MANAGE_SCHEDULE',
          now()+($5::integer*interval '1 second'))
      `,[challengeId,contact.contact_id,requestId.toLowerCase(),codeHash,GUEST_OTP_POLICY.ttlSeconds]);
      return {channel:contact.channel,contact:decryptGuestContact(contact.encrypted_value,encryptionKey)};
    });
    if(!result)return null;
    return {challengeId,code,channel:result.channel,contact:result.contact,
      expiresInSeconds:GUEST_OTP_POLICY.ttlSeconds};
  }
}
