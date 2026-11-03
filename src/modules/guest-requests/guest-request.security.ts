import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Security primitives only. These are not HTTP endpoints: OTP delivery, database
 * transactions, abuse throttles, and a verified contact are prerequisites.
 * Never log raw contact information, verification codes or capability tokens.
 */
export const GUEST_OTP_POLICY = Object.freeze({
  digits: 6,
  ttlSeconds: 600,
  maxAttempts: 5,
  capabilityTtlSeconds: 900,
});

export type ContactChannel = 'email' | 'sms';

export function normalizeGuestContact(channel: ContactChannel, input: unknown): string {
  if (typeof input !== 'string') throw new Error('invalid_contact');
  const contact = input.trim();
  if (channel === 'sms') {
    if (!/^\+[1-9][0-9]{7,14}$/.test(contact)) throw new Error('invalid_contact');
    return contact;
  }
  if (channel !== 'email') throw new Error('invalid_contact');
  if (contact.length > 320 || contact.length < 3 || /[\s\x00-\x1f\x7f]/.test(contact)) {
    throw new Error('invalid_contact');
  }
  const at = contact.lastIndexOf('@');
  if (at < 1 || at === contact.length - 1 || contact.indexOf('@') !== at) {
    throw new Error('invalid_contact');
  }
  const local = contact.slice(0, at);
  const domain = contact.slice(at + 1).toLowerCase();
  if (local.length > 64 || domain.length > 253 ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(domain) ||
      domain.includes('..') || !domain.includes('.') ||
      domain.split('.').some(x => !x || x.length > 63 || x.startsWith('-') || x.endsWith('-'))) {
    throw new Error('invalid_contact');
  }
  return local + '@' + domain;
}

export function requireSecret(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('secret_not_configured');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new Error('secret_not_configured');
  return key;
}

function hmac(domain: string, secret: Buffer, value: string): string {
  if (secret.length !== 32) throw new Error('invalid_secret');
  return createHmac('sha256', secret).update(domain).update('\0').update(value, 'utf8').digest('hex');
}

/** Stable, non-reversible lookup key; does not expose contact address to indexes. */
export function contactDigest(channel: ContactChannel, normalizedContact: string, pepper: Buffer): string {
  return hmac('guest-contact:v1', pepper, channel + '\0' + normalizedContact);
}

/** Bind verification proof to exactly one challenge; no plaintext OTP in database. */
export function makeOtpChallenge(challengeId: string, pepper: Buffer): {code: string; codeHash: string} {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(challengeId)) throw new Error('invalid_challenge');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  return {code, codeHash: hashOtp(challengeId, code, pepper)};
}
export function hashOtp(challengeId: string, code: string, pepper: Buffer): string {
  return hmac('guest-otp:v1', pepper, challengeId + '\0' + code);
}
export function verifyOtp(challengeId: string, candidate: unknown, storedHash: string, pepper: Buffer): boolean {
  if (typeof candidate !== 'string' || !/^[0-9]{6}$/.test(candidate) ||
      !/^[0-9a-f]{64}$/i.test(storedHash)) return false;
  const actual = Buffer.from(hashOtp(challengeId, candidate, pepper), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return timingSafeEqual(actual, expected);
}

export function canVerifyOtp(
  challenge: {expiresAt: Date; attempts: number; consumedAt: Date | null},
  now: Date,
): boolean {
  return Number.isInteger(challenge.attempts) &&
    challenge.attempts >= 0 && challenge.attempts < GUEST_OTP_POLICY.maxAttempts &&
    challenge.consumedAt === null && challenge.expiresAt.getTime() > now.getTime();
}

/** Capabilities are opaque, randomly generated, purpose-scoped and hash-stored. */
export function issueGuestCapability(purpose: 'CREATE_REQUEST' | 'READ_CANCEL' | 'MANAGE_SCHEDULE', pepper: Buffer) {
  const token = randomBytes(32).toString('base64url');
  return {token, tokenHash: hashGuestCapability(purpose, token, pepper)};
}
export function hashGuestCapability(
  purpose: 'CREATE_REQUEST' | 'READ_CANCEL' | 'MANAGE_SCHEDULE',
  token: string,
  pepper: Buffer,
): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('invalid_capability');
  return hmac('guest-capability:v1', pepper, purpose + '\0' + token);
}

/** AES-GCM at-rest encryption; includes random IV and authentication tag. */
export function encryptGuestContact(normalizedContact: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('invalid_key');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(normalizedContact, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url')].join('.');
}
export function decryptGuestContact(record: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('invalid_key');
  const parts = record.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('invalid_ciphertext');
  const [, ivText, tagText, bodyText] = parts;
  const iv = Buffer.from(ivText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  if (iv.length !== 12 || tag.length !== 16 || !bodyText) throw new Error('invalid_ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString('utf8');
}
