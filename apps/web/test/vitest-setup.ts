/**
 * Vitest setup — registers `@testing-library/jest-dom` matchers globally
 * for component specs (`toBeInTheDocument`, `toBeDisabled`, etc.) and
 * wires `cleanup()` after every test so DOM nodes from a previous render
 * don't leak (testing-library only auto-cleans when `globals: true`).
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});
