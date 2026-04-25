// Stub for `server-only` package in vitest. Real package throws on import
// from a client context; in tests we import server modules directly and
// don't need the boundary check.
export {};
