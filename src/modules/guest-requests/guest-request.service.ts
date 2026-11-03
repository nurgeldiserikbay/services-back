import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { DatabasePool } from '../../platform/database/database.pool.js';
import { createGuestRequestInTransaction, type CreatedGuestRequest } from './guest-request.transaction.js';
import { requireSecret } from './guest-request.security.js';
import { validateGuestRequestBody, validateIdempotencyKey } from './guest-request.validation.js';

/**
 * Internal application service, not a controller. Keep the public HTTP route
 * disabled until SMS/email OTP issuance, global abuse budgets, secure browser
 * proof transport and outbox delivery are approved and integration-tested.
 */
@Injectable()
export class GuestRequestService {
  constructor(private readonly db: DatabasePool) {}

  async createFromVerifiedContact(
    untrustedBody: unknown,
    createCapability: string,
    untrustedKey: unknown,
  ): Promise<CreatedGuestRequest> {
    const input = validateGuestRequestBody(untrustedBody);
    const key = validateIdempotencyKey(untrustedKey);
    if (typeof createCapability !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(createCapability)) {
      // Do not disclose token bytes, whether a contact exists or whether it
      // has a prior request.
      throw new ServiceUnavailableException('Guest request proof unavailable');
    }
    // These secrets must be configured in an approved KZ-resident environment.
    const pepper = requireSecret(process.env.GUEST_REQUEST_HMAC_KEY);
    const encryptionKey = requireSecret(process.env.GUEST_CONTACT_ENCRYPTION_KEY);
    if (timingSafeEqual(pepper, encryptionKey)) {
      throw new ServiceUnavailableException('Guest request keys must be distinct');
    }
    return this.db.transaction(client =>
      createGuestRequestInTransaction(
        client, input, createCapability, key, pepper, encryptionKey,
      ),
    );
  }
}
