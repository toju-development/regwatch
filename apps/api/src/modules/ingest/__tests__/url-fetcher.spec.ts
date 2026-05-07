/**
 * Unit tests for `url-fetcher.ts`.
 *
 * sdd/manual-ingestion B4.8:
 *   - SSRF rejection: RFC1918 IP, loopback, non-HTTPS scheme.
 *   - Happy path: mocked undici response → returns text.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SsrfBlockedError, fetchUrl } from '../utils/url-fetcher.js';

// Mock undici
vi.mock('undici', () => ({
  fetch: vi.fn(),
}));

// Mock DNS — must be top-level (Vitest hoists vi.mock calls)
vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
  },
}));

import { fetch as undiciFetch } from 'undici';
const mockedFetch = vi.mocked(undiciFetch);

function makeResponse(
  text: string,
  opts: { status?: number; contentType?: string } = {},
): Response {
  const { status = 200, contentType = 'text/plain' } = opts;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType }),
    body: stream,
  } as unknown as Response;
}

describe('fetchUrl — SSRF guard', () => {
  it('blocks non-HTTPS URL (http)', async () => {
    await expect(fetchUrl('http://example.com/doc')).rejects.toThrow(SsrfBlockedError);
  });

  it('blocks non-HTTPS URL (ftp)', async () => {
    await expect(fetchUrl('ftp://example.com/doc')).rejects.toThrow(SsrfBlockedError);
  });

  it('blocks invalid URL', async () => {
    await expect(fetchUrl('not-a-url')).rejects.toThrow(SsrfBlockedError);
  });

  it('blocks RFC1918 IP 192.168.x (direct IP literal)', async () => {
    await expect(fetchUrl('https://192.168.1.1/doc')).rejects.toThrow(SsrfBlockedError);
  });

  it('blocks RFC1918 IP 10.x (direct IP literal)', async () => {
    await expect(fetchUrl('https://10.0.0.1/doc')).rejects.toThrow(SsrfBlockedError);
  });

  it('blocks loopback 127.0.0.1 (direct IP literal)', async () => {
    await expect(fetchUrl('https://127.0.0.1/doc')).rejects.toThrow(SsrfBlockedError);
  });

  it('blocks IPv6 loopback ::1', async () => {
    await expect(fetchUrl('https://[::1]/doc')).rejects.toThrow(SsrfBlockedError);
  });
});

describe('fetchUrl — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns text from mocked undici response', async () => {
    mockedFetch.mockResolvedValueOnce(
      makeResponse('hello world') as unknown as Awaited<ReturnType<typeof undiciFetch>>,
    );

    const result = await fetchUrl('https://example.com/doc');
    expect(result.text).toBe('hello world');
    expect(result.title).toBeUndefined();
  });

  it('extracts title from HTML response', async () => {
    mockedFetch.mockResolvedValueOnce(
      makeResponse('<html><head><title>Test Page</title></head><body>content</body></html>', {
        contentType: 'text/html',
      }) as unknown as Awaited<ReturnType<typeof undiciFetch>>,
    );

    const result = await fetchUrl('https://example.com/page');
    expect(result.text).toContain('content');
    expect(result.title).toBe('Test Page');
  });
});
