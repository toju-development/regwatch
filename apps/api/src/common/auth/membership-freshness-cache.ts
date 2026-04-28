/**
 * In-memory cache for `MembershipFreshnessGuard` — `(userId, jwtIat)
 * → User.membershipsVersion` keyed entries with absolute-expiry TTL.
 *
 * Deliberately NOT a class-level singleton: the instance is provided
 * via DI under {@link MEMBERSHIP_FRESHNESS_CACHE} (`MembersModule`)
 * so tests can substitute a mock and assert call counts.
 *
 * Eviction is opportunistic — `get()` drops expired entries on read
 * (no background timer, no LRU). For MVP single-process scale this
 * is sufficient: each `(userId, iat)` pair only lives until the JWT
 * is re-minted (post `update({})`) or the TTL elapses.
 *
 * Spec: `sdd/org-members/spec` R-Jwt-Invalidate-Cross-User
 *   S "Cache amortizes per-request DB hit".
 * Design: `sdd/org-members/design` §0 #3, §3.
 */
export interface FreshnessCacheEntry {
  /** The cached `User.membershipsVersion` value at the time of write. */
  version: number;
  /** Epoch ms after which the entry is treated as missing. */
  expiresAt: number;
}

export interface FreshnessCache {
  /**
   * Returns the cached entry, or `undefined` if absent or expired
   * (expired entries are evicted as a side effect of the read).
   */
  get(key: string): FreshnessCacheEntry | undefined;
  /** Writes `version` keyed by `key` with absolute expiry `now + ttlMs`. */
  set(key: string, version: number, ttlMs: number): void;
  /** Test-only escape hatch — clears every entry. */
  clear(): void;
  /** Test-only — current entry count (post-eviction). */
  size(): number;
}

export class InMemoryFreshnessCache implements FreshnessCache {
  private readonly map = new Map<string, FreshnessCacheEntry>();

  get(key: string): FreshnessCacheEntry | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, version: number, ttlMs: number): void {
    this.map.set(key, { version, expiresAt: Date.now() + ttlMs });
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}

/**
 * Build the cache key from the authenticated principal's `userId` and
 * the verified JWT `iat` claim. Including `iat` is what makes a JWT
 * re-mint (after `update({})`) automatically miss the cache —
 * no manual invalidation needed.
 */
export function buildFreshnessKey(userId: string, jwtIat: number): string {
  return `${userId}:${jwtIat}`;
}
