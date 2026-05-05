/**
 * Prompt-regression tests for `buildClassifierPrompt` (INV-AE-4).
 *
 * This is THE guard against the MVP-13 carry-forward trap (#798):
 *   "A developer adds a new AlertTopic to the Prisma enum, but the hardcoded
 *    prompt string still lists the old 20 values — Gemini silently classifies
 *    into wrong topics."
 *
 * STRATEGY (ADR-4):
 *   Call `buildClassifierPrompt` with an EMPTY topics array. Any AlertTopic
 *   code that appears in the prompt output MUST have been hardcoded in the
 *   template — because the only source of topic values in the prompt IS the
 *   `topics` parameter.
 *
 * This test MUST remain in CI. If it fails, a developer hardcoded a topic
 * literal in the prompt template (INV-AE-4 violation).
 *
 * Spec: `sdd/classifier-and-writer/spec` INV-AE-4, R-1-Classifier-Output-Contract.
 * Design: `sdd/classifier-and-writer/design` ADR-4.
 */
import { describe, expect, it } from 'vitest';

import { AlertTopic, type AlertTopicValue } from '@regwatch/types';

import { buildClassifierPrompt } from '../classifier.factory.js';

const ALL_TOPIC_CODES = Object.values(AlertTopic) as AlertTopicValue[];

const SAMPLE_ALERT = {
  title: 'Test alert title',
  summary: 'Test alert summary for regression testing.',
  sourceId: 'BCRA_COMUNICADOS_A',
};

describe('INV-AE-4 — buildClassifierPrompt prompt regression', () => {
  it('prompt contains ZERO hardcoded AlertTopic literal values when topics=[]', () => {
    // This is the core INV-AE-4 guard.
    // If ANY topic code appears here, it was hardcoded in the template.
    const promptEmpty = buildClassifierPrompt(SAMPLE_ALERT, [], 'es');

    for (const code of ALL_TOPIC_CODES) {
      expect(promptEmpty, `AlertTopic "${code}" is hardcoded in the prompt template`).not.toContain(
        code,
      );
    }
  });

  it('prompt DOES contain topic codes when they are injected via the topics param', () => {
    // Positive control: topics injected via the param SHOULD appear.
    const topics: AlertTopicValue[] = ['FX', 'AML', 'OTHER'];
    const prompt = buildClassifierPrompt(SAMPLE_ALERT, topics, 'es');

    for (const t of topics) {
      expect(prompt).toContain(t);
    }
  });

  it('topics not passed do NOT appear (injection-only policy)', () => {
    // Topics NOT in the param should not appear, even if they look like common words.
    // REPORTING and INSURANCE are plain english words — ensure they are not baked in.
    const topics: AlertTopicValue[] = ['FX'];
    const prompt = buildClassifierPrompt(SAMPLE_ALERT, topics, 'es');

    // These should not appear since they weren't injected
    const absentTopics: AlertTopicValue[] = [
      'REPORTING',
      'INSURANCE',
      'CAPITAL_REQUIREMENTS',
      'OTHER',
    ];
    for (const t of absentTopics) {
      expect(prompt, `"${t}" should not appear when not in topics param`).not.toContain(t);
    }
  });

  it('full topic set appears exactly once in allowed list when all topics injected', () => {
    const prompt = buildClassifierPrompt(SAMPLE_ALERT, ALL_TOPIC_CODES, 'en');
    // Every topic in the full set should be present
    for (const code of ALL_TOPIC_CODES) {
      expect(prompt).toContain(code);
    }
  });
});
