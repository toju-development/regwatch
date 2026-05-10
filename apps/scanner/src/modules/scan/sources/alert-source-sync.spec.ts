/**
 * Zod ↔ Prisma sync guard for AlertSource enum (MVP-13).
 *
 * Ensures `AlertSourceSchema` (Zod, packages/types) and `AlertSource`
 * (Prisma generated client) stay in sync. If they drift, any new value
 * accepted by Zod will fail at DB persist time (or vice-versa), causing
 * silent 100% scan FAILED runs for the affected jurisdiction.
 *
 * This test is the automated enforcement of the "append both enums together"
 * convention (sdd/scanners-br-co-pe-cl/design — Zod/Prisma sync decision).
 *
 * Spec: sdd/scanners-br-co-pe-cl/spec R-AlertSource-Enum-Extended.
 */
import { describe, expect, it } from 'vitest';

import { AlertSource as PrismaAlertSource } from '@regwatch/db/client';
import { AlertSourceSchema } from '@regwatch/types/scanner';

describe('AlertSource — Zod/Prisma enum sync', () => {
  it('AlertSourceSchema values match Prisma AlertSource enum exactly (no drift)', () => {
    const zodValues = new Set(AlertSourceSchema.options);
    const prismaValues = new Set(Object.keys(PrismaAlertSource));
    expect(zodValues).toEqual(prismaValues);
  });

  it('AlertSourceSchema includes all MVP-13 BR, CO, PE, CL values', () => {
    const mvp13Values = [
      'BCB_CIRCULARES',
      'BCB_RESOLUCOES',
      'CVM_RESOLUCOES',
      'SFC_CIRCULARES_EXTERNAS',
      'SBS_RESOLUCIONES',
      'SBS_CIRCULARES',
      'CMF_NORMAS',
      'CMF_RESOLUCIONES',
    ];
    for (const v of mvp13Values) {
      expect(AlertSourceSchema.safeParse(v).success).toBe(true);
    }
  });

  it('AlertSourceSchema includes MVP-15 EMAIL_INBOUND value', () => {
    expect(AlertSourceSchema.safeParse('EMAIL_INBOUND').success).toBe(true);
  });
});
