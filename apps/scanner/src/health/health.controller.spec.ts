import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('returns the healthcheck contract for service=scanner', () => {
    const controller = new HealthController();
    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('scanner');
    expect(typeof result.uptime).toBe('number');
    expect(typeof result.version).toBe('string');
  });
});
