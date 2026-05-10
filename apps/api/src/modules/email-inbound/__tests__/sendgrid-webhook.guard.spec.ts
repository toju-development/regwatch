/**
 * Unit tests for `SendGridWebhookGuard`.
 *
 * sdd/email-inbound Phase 4 task 4.1.
 *
 * Cases:
 *   (a) No secret set → canActivate returns true (dev mode passthrough)
 *   (b) Invalid signature → throws ForbiddenException
 *   (c) Valid ECDSA signature (pre-signed test fixture) → returns true
 *
 * ECDSA test fixture: prime256v1 (P-256) / SHA-256 pair generated inline using
 * Node's `crypto.generateKeyPairSync`. We sign a known payload and verify
 * that the guard accepts it.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { SendGridWebhookGuard } from '../guards/sendgrid-webhook.guard.js';

/** Minimal ExecutionContext mock for HTTP tests. */
function makeContext(opts: {
  signature?: string;
  timestamp?: string;
  rawBody?: Buffer;
}): ExecutionContext {
  const { signature, timestamp, rawBody = Buffer.from('') } = opts;
  const headers: Record<string, string | undefined> = {};
  if (signature !== undefined) headers['x-twilio-email-event-webhook-signature'] = signature;
  if (timestamp !== undefined) headers['x-twilio-email-event-webhook-timestamp'] = timestamp;

  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, rawBody }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(secret?: string): SendGridWebhookGuard {
  // Construct directly — bypass DI.
  return new (SendGridWebhookGuard as unknown as new (env: unknown) => SendGridWebhookGuard)({
    EMAIL_INBOUND_WEBHOOK_SECRET: secret,
  });
}

describe('SendGridWebhookGuard', () => {
  it('(a) no secret set → canActivate returns true (dev mode)', () => {
    const guard = makeGuard(undefined);
    const ctx = makeContext({});
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('(b) invalid signature → throws ForbiddenException', () => {
    const guard = makeGuard(
      '-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEfake==\n-----END PUBLIC KEY-----',
    );
    const ctx = makeContext({
      signature: 'invalidsignature==',
      timestamp: '1234567890',
      rawBody: Buffer.from('payload'),
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  describe('(c) valid ECDSA signature → returns true', () => {
    let publicKeyPem: string;
    let signature: string;
    const timestamp = '1715000000';
    const rawBody = Buffer.from('{"to":"acme@inbound.regwatch.io"}');

    beforeAll(() => {
      // Generate an ephemeral secp256k1 key pair for the test fixture.
      const { privateKey, publicKey } = generateKeyPairSync('ec', {
        namedCurve: 'prime256v1', // P-256, same algorithm family as SendGrid's key
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      publicKeyPem = publicKey as string;

      const signer = createSign('SHA256');
      signer.update(timestamp);
      signer.update(rawBody);
      signature = signer.sign(privateKey as string, 'base64');
    });

    it('verifies the pre-signed fixture', () => {
      const guard = makeGuard(publicKeyPem);
      const ctx = makeContext({ signature, timestamp, rawBody });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  it('(b2) missing signature header → throws ForbiddenException', () => {
    const guard = makeGuard('some-secret');
    // No signature or timestamp provided
    const ctx = makeContext({ timestamp: '1234567890' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('(b3) missing timestamp header → throws ForbiddenException', () => {
    const guard = makeGuard('some-secret');
    const ctx = makeContext({ signature: 'abc' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
