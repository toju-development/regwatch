/**
 * Unit tests for `ResendEmailAdapter`.
 *
 * sdd/notify-email-resend (POST-2) — task 7.4.
 *
 * Mocks `fetch` globally; asserts POST to `api.resend.com` with correct
 * `Authorization` header and body shape. Asserts throws on non-2xx.
 *
 * NO `pnpm build` after changes (project rule).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResendEmailAdapter } from '../adapters/resend.adapter.js';

const API_KEY = 'test-resend-api-key';
const FROM_EMAIL = 'noreply@regwatch.io';

function makeAdapter() {
  return new (ResendEmailAdapter as unknown as new (
    apiKey: string,
    fromEmail: string,
  ) => ResendEmailAdapter)(API_KEY, FROM_EMAIL);
}

function makeFetchOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue('{"id":"msg-1"}'),
  });
}

function makeFetchFail(status = 500) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: vi.fn().mockResolvedValue('Internal Server Error'),
  });
}

describe('ResendEmailAdapter', () => {
  let adapter: ResendEmailAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = makeAdapter();
    fetchMock = makeFetchOk();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to api.resend.com/emails with correct Authorization header', async () => {
    await adapter.send({
      to: 'user@example.com',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((options.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${API_KEY}`);
  });

  it('sends correct body shape (from, to, subject, html, text)', async () => {
    await adapter.send({
      to: 'user@example.com',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]! as [string, RequestInit])[1].body as string,
    ) as { from: string; to: string; subject: string; html: string; text: string };
    expect(body.from).toBe(FROM_EMAIL);
    expect(body.to).toBe('user@example.com');
    expect(body.subject).toBe('Test Subject');
    expect(body.html).toBe('<p>Hello</p>');
    expect(body.text).toBe('Hello');
  });

  it('throws when Resend returns non-2xx', async () => {
    vi.stubGlobal('fetch', makeFetchFail(422));

    await expect(
      adapter.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    ).rejects.toThrow('422');
  });
});
