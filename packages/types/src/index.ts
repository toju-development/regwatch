/**
 * Shape returned by every app's healthcheck endpoint.
 * Spec: bootstrap-monorepo § packages/types.
 */
export type HealthStatus = {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  uptime: number;
  version: string;
};

export * from './auth.js';
export * from './jurisdictions.js';
export * from './settings.js';
export * from './events.js';
