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
