/**
 * apps/web env loader — composes core + web slices.
 *
 * Spec: auth-foundation § config — Per-app env slices (`createWebEnv`).
 * Operator decision #624: dev/CI uses memory transport + fake-google.
 *
 * Import this module instead of touching `process.env` directly anywhere
 * inside `apps/web/src/**`.
 */
import 'server-only';
import { createWebEnv } from '@regwatch/config/web';

export const env = createWebEnv();
