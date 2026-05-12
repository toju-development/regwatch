/**
 * @vitest-environment node
 *
 * Unit tests for `buildProviders()` — conditional provider array construction.
 *
 * Spec: sdd/auth-ms-entra R-ENTRA-1 / R-ENTRA-6 / R-ENTRA-7.
 * Design: § Interfaces / Contracts — `buildProviders(cfg: WebConfig)`.
 *
 * Provider constructors are mocked to avoid network/auth side effects.
 * Tests assert that:
 *   (a) no Entra vars → MicrosoftEntraId absent from array
 *   (b) all Entra vars → MicrosoftEntraId present in array
 *   (c) AUTH_FAKE_ENTRA=true → fake provider present
 *   (d) AUTH_FAKE_GOOGLE=true → fake Google provider present
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoist mock factories so they can be referenced inside vi.mock() ---
const { mockMicrosoftEntraId, mockFakeGoogleProvider, mockFakeEntraProvider } = vi.hoisted(() => ({
  mockMicrosoftEntraId: vi.fn().mockReturnValue({ id: 'microsoft-entra-id' }),
  mockFakeGoogleProvider: vi.fn().mockReturnValue({ id: 'google-fake' }),
  mockFakeEntraProvider: vi.fn().mockReturnValue({ id: 'microsoft-entra-id-fake' }),
}));

vi.mock('next-auth/providers/microsoft-entra-id', () => ({
  default: mockMicrosoftEntraId,
}));

vi.mock('@/lib/auth-providers/fake-google', () => ({
  fakeGoogleProvider: mockFakeGoogleProvider,
}));

vi.mock('@/lib/auth-providers/fake-entra', () => ({
  fakeEntraProvider: mockFakeEntraProvider,
}));

// Import AFTER mocks are registered
import { buildProviders } from '../auth-config.js';
import type { WebEnv } from '@regwatch/config/web';

// Minimal WebEnv shape for testing — only the fields `buildProviders` inspects
function makeConfig(overrides: Partial<WebEnv> = {}): WebEnv {
  return {
    AUTH_FAKE_GOOGLE: false,
    AUTH_MICROSOFT_ENTRA_ID: undefined,
    AUTH_MICROSOFT_ENTRA_SECRET: undefined,
    AUTH_MICROSOFT_ENTRA_TENANT_ID: undefined,
    AUTH_FAKE_ENTRA: undefined,
    ...overrides,
  } as unknown as WebEnv;
}

describe('buildProviders()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMicrosoftEntraId.mockReturnValue({ id: 'microsoft-entra-id' });
    mockFakeGoogleProvider.mockReturnValue({ id: 'google-fake' });
    mockFakeEntraProvider.mockReturnValue({ id: 'microsoft-entra-id-fake' });
  });

  // --- R-ENTRA-1: provider absent when vars not set ---

  it('returns empty array when no optional vars are set', () => {
    const providers = buildProviders(makeConfig());
    expect(providers).toHaveLength(0);
    expect(mockMicrosoftEntraId).not.toHaveBeenCalled();
  });

  it('does NOT include MicrosoftEntraId when Entra vars are absent', () => {
    const providers = buildProviders(makeConfig());
    const ids = providers.map((p) => (p as { id: string }).id);
    expect(ids).not.toContain('microsoft-entra-id');
  });

  // --- R-ENTRA-1: provider included when all three vars are set ---

  it('includes MicrosoftEntraId when all three Entra vars are present', () => {
    const providers = buildProviders(
      makeConfig({
        AUTH_MICROSOFT_ENTRA_ID: 'client-id',
        AUTH_MICROSOFT_ENTRA_SECRET: 'secret',
        AUTH_MICROSOFT_ENTRA_TENANT_ID: 'common',
      }),
    );
    expect(mockMicrosoftEntraId).toHaveBeenCalledOnce();
    expect(mockMicrosoftEntraId).toHaveBeenCalledWith({
      clientId: 'client-id',
      clientSecret: 'secret',
      issuer: 'https://login.microsoftonline.com/common/v2.0/',
    });
    const ids = providers.map((p) => (p as { id: string }).id);
    expect(ids).toContain('microsoft-entra-id');
  });

  // --- Partial config: should not mount provider (INV-ENTRA-1) ---
  // Note: createWebEnv() already rejects partial config at startup.
  // buildProviders() also defensively checks all three vars.

  it('does NOT include MicrosoftEntraId when only one var is set', () => {
    const providers = buildProviders(makeConfig({ AUTH_MICROSOFT_ENTRA_ID: 'client-id' }));
    expect(mockMicrosoftEntraId).not.toHaveBeenCalled();
    const ids = providers.map((p) => (p as { id: string }).id);
    expect(ids).not.toContain('microsoft-entra-id');
  });

  // --- AUTH_FAKE_ENTRA dev provider ---

  it('includes fakeEntraProvider when AUTH_FAKE_ENTRA is "true"', () => {
    const providers = buildProviders(makeConfig({ AUTH_FAKE_ENTRA: 'true' }));
    expect(mockFakeEntraProvider).toHaveBeenCalledOnce();
    const ids = providers.map((p) => (p as { id: string }).id);
    expect(ids).toContain('microsoft-entra-id-fake');
  });

  it('does NOT include fakeEntraProvider when AUTH_FAKE_ENTRA is undefined', () => {
    buildProviders(makeConfig());
    expect(mockFakeEntraProvider).not.toHaveBeenCalled();
  });

  it('does NOT include fakeEntraProvider when AUTH_FAKE_ENTRA is "false"', () => {
    buildProviders(makeConfig({ AUTH_FAKE_ENTRA: 'false' }));
    expect(mockFakeEntraProvider).not.toHaveBeenCalled();
  });

  // --- AUTH_FAKE_GOOGLE — existing behavior must not break (R-ENTRA-6) ---

  it('includes fakeGoogleProvider when AUTH_FAKE_GOOGLE is true', () => {
    const providers = buildProviders(makeConfig({ AUTH_FAKE_GOOGLE: true }));
    expect(mockFakeGoogleProvider).toHaveBeenCalledOnce();
    const ids = providers.map((p) => (p as { id: string }).id);
    expect(ids).toContain('google-fake');
  });

  it('does NOT include fakeGoogleProvider when AUTH_FAKE_GOOGLE is false', () => {
    buildProviders(makeConfig({ AUTH_FAKE_GOOGLE: false }));
    expect(mockFakeGoogleProvider).not.toHaveBeenCalled();
  });

  // --- Combined: all optional providers at once ---

  it('includes all optional providers when all flags are active', () => {
    const providers = buildProviders(
      makeConfig({
        AUTH_FAKE_GOOGLE: true,
        AUTH_MICROSOFT_ENTRA_ID: 'client-id',
        AUTH_MICROSOFT_ENTRA_SECRET: 'secret',
        AUTH_MICROSOFT_ENTRA_TENANT_ID: 'tenant',
        AUTH_FAKE_ENTRA: 'true',
      }),
    );
    const ids = providers.map((p) => (p as { id: string }).id);
    expect(ids).toContain('google-fake');
    expect(ids).toContain('microsoft-entra-id');
    expect(ids).toContain('microsoft-entra-id-fake');
    expect(providers).toHaveLength(3);
  });
});
