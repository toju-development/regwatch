/**
 * Zod schemas for Classifier and Writer agent outputs.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-1-Classifier-Output-Contract,
 *   R-2-Writer-Output-Contract, R-6-Trust-Boundary.
 * Design: `sdd/classifier-and-writer/design` ADR-1 (two agents), ADR-2
 *   (AlertTopic as runtime param), ADR-5 (citation contract), ADR-11
 *   (trust boundary — assertNoForbiddenKeys after parse).
 *
 * LEAF-PACKAGE INVARIANT (mirrors `auth.ts` pattern):
 *   `packages/types` MUST NOT depend on `@regwatch/db`. `AlertTopic` is
 *   mirrored here as a const object (INVARIANT: keep in sync with Prisma
 *   `AlertTopic` enum in `packages/db/prisma/schema.prisma`).
 *
 * SECURITY INVARIANT (R-6, INV-AE-1, ADR-11):
 *   Both schemas use `.strict()` to reject extra keys at the Zod boundary.
 *   `assertNoForbiddenKeys` (from `packages/types/src/security/`) MUST be
 *   applied AFTER parse as the second fence.
 *
 * NOTE: Pure data + Zod. No NestJS deps, no `'server-only'`, no Node-only deps.
 */
import { z } from 'zod';

// ─── AlertTopic (mirrored from @regwatch/db — leaf-package constraint) ────────

/**
 * 20-value regulatory taxonomy mirror.
 *
 * Mirrors Prisma `AlertTopic` enum from `packages/db/prisma/schema.prisma`
 * (migration #9, MVP-6). Keep in sync if the Prisma enum changes.
 *
 * Values are SCREAMING_SNAKE_CASE English. `OTHER` is the safety net when
 * no topic clearly fits. `z.nativeEnum(AlertTopic)` validates agent output.
 *
 * ADR-4 / INV-AE-4: the enum VALUES are never hardcoded in prompt text —
 * the prompt builder injects them at runtime from this source.
 */
export const AlertTopic = {
  FX: 'FX',
  AML: 'AML',
  KYC_ONBOARDING: 'KYC_ONBOARDING',
  CAPITAL_REQUIREMENTS: 'CAPITAL_REQUIREMENTS',
  OPERATIONAL_RISK: 'OPERATIONAL_RISK',
  CYBERSECURITY: 'CYBERSECURITY',
  REPORTING: 'REPORTING',
  CAPITAL_MARKETS: 'CAPITAL_MARKETS',
  E_MONEY: 'E_MONEY',
  ACQUIRING: 'ACQUIRING',
  REMITTANCES: 'REMITTANCES',
  BILL_PAYMENTS: 'BILL_PAYMENTS',
  QR_PAYMENTS: 'QR_PAYMENTS',
  VIRTUAL_ASSETS: 'VIRTUAL_ASSETS',
  LENDING_CREDIT: 'LENDING_CREDIT',
  OPEN_FINANCE: 'OPEN_FINANCE',
  CONSUMER_PROTECTION: 'CONSUMER_PROTECTION',
  INSURANCE: 'INSURANCE',
  DATA_PROTECTION: 'DATA_PROTECTION',
  OTHER: 'OTHER',
} as const;

/** TS union of all AlertTopic values. Mirrors the Prisma enum. */
export type AlertTopicValue = (typeof AlertTopic)[keyof typeof AlertTopic];

// ─── ClassifierOutput ─────────────────────────────────────────────────────────

/**
 * Parsed + validated output from the Classifier agent.
 *
 * SECURITY: Does NOT include `organizationId`, `userId`, or any persistence
 * keys. LLM-derived tenant ids are a P0 breach (INV-AE-1). Extra keys are
 * rejected by `.strict()` before `assertNoForbiddenKeys` runs as the second
 * fence.
 *
 * Severity bucket (spec P1, AMENDED B1.1):
 *   `UNKNOWN` is NOT in ClassifierOutput — it is a failure-only sentinel
 *   that appears only when enrichmentStatus=CLASSIFY_FAILED (R-1). The
 *   Classifier MUST return one of LOW|MEDIUM|HIGH|CRITICAL on success.
 *
 * relevanceScore (spec P2, AMENDED B1.1):
 *   Int 0..100. ADR-2 rationale: relevance is not money; Decimal arithmetic
 *   overhead not justified. `0` means irrelevant; `100` means maximum relevance.
 */
export const ClassifierOutputSchema = z
  .object({
    topic: z.nativeEnum(AlertTopic),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    relevanceScore: z.number().int().min(0).max(100),
    relevant: z.boolean(),
  })
  .strict();

export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;

// ─── WriterOutput ─────────────────────────────────────────────────────────────

/**
 * Parsed + validated output from the Writer agent.
 *
 * SECURITY: Same constraints as ClassifierOutput. `.strict()` rejects extra
 * keys at the Zod boundary.
 *
 * Citation contract (spec R-2, ADR-5):
 *   Every citation MUST be a verifiable substring of `Alert.summary`
 *   (normalized: lowercase + collapse whitespace). Validated AFTER Zod
 *   parse by `validateCitations()` from `citation.validator.ts`.
 *   On any citation miss, the entire Writer output is rejected
 *   (NO partial accept — atomic contract). ≥1 citation required.
 *
 * Min-length guards on prose fields are intentionally generous (50/20)
 * to catch Gemini empty-string responses while allowing short summaries.
 */
export const WriterOutputSchema = z
  .object({
    executiveSummary: z.string().min(50).max(2000),
    whatChangesForYou: z.string().min(20).max(1500),
    citations: z.array(z.string().min(10).max(500)).min(1).max(10),
  })
  .strict();

export type WriterOutput = z.infer<typeof WriterOutputSchema>;
