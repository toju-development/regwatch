/**
 * Writer agent factory for alert enrichment.
 *
 * Builds a callable Gemini agent that produces user-facing analysis for
 * relevant alerts: executiveSummary, whatChangesForYou, citations.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-2-Writer-Output-Contract,
 *   R-4-Output-Language-Resolution.
 * Design: `sdd/classifier-and-writer/design` ADR-1 (Writer runs ONLY for
 *   relevant=true alerts), ADR-3 (universal factory), ADR-5 (citation contract —
 *   citations MUST be verbatim substrings of Alert.summary).
 *
 * KEY DIFFERENCES FROM ClassifierFactory:
 *   - Language IS prominent here — Writer produces user-facing prose in the
 *     resolved language. The prompt stresses the target language for all output.
 *   - topic + severity are passed as resolved values (already classified in B3).
 *     No runtime enum injection needed — they are human-readable context, not
 *     classification choices.
 *   - Citations MUST be exact verbatim substrings of the provided Alert.summary.
 *     The prompt stresses this constraint explicitly to reduce hallucinated cites.
 *   - Uses responseSchema for structured JSON (same as Classifier — googleSearch
 *     is NOT used here; responseSchema + googleSearch are mutually exclusive).
 *
 * SECURITY INVARIANT (INV-AE-1, ADR-11):
 *   Prompt MUST NOT request organizationId, userId, email or any tenant key.
 *   Writer produces content fields only — no persistence keys in output contract.
 */
import type { GoogleGenAI } from '@google/genai';

import type { OutputLanguage } from '../utils/language.helper.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';

const LANGUAGE_LABELS: Record<OutputLanguage, string> = {
  es: 'Spanish (Español)',
  pt: 'Portuguese (Português)',
  en: 'English',
};

/**
 * Build the Writer prompt as a single string.
 *
 * Exported for unit tests so prompt drift and language-injection are detectable
 * without an HTTP call. Same testability pattern as `buildClassifierPrompt`.
 *
 * @param alert    - Alert metadata: title, summary, topic, severity.
 *                   NEVER include orgId. topic/severity are already resolved.
 * @param language - Resolved output language (R-4). ALL prose fields must be
 *                   written in this language.
 */
export function buildWriterPrompt(
  alert: { title: string; summary: string; topic: string; severity: string },
  language: OutputLanguage,
): string {
  const langLabel = LANGUAGE_LABELS[language];

  const lines = [
    'You are a regulatory compliance analyst writing for fintech professionals.',
    `Write the analysis IN ${langLabel} — ALL prose fields MUST be in ${langLabel}.`,
    '',
    'OUTPUT: Return ONLY a valid JSON object matching this shape exactly:',
    '{',
    '  "executiveSummary": "<2-3 paragraphs summarising the regulation and its implications>",',
    '  "whatChangesForYou": "<actionable impact — what the fintech must do or monitor>",',
    '  "citations": ["<verbatim substring from the source text>", ...]',
    '}',
    '',
    'WRITING RULES:',
    `  - executiveSummary: 2-3 paragraphs, written in ${langLabel}. Cover: what the regulation is, who it affects, and key deadlines or thresholds.`,
    `  - whatChangesForYou: short, actionable paragraph in ${langLabel}. Describe concrete steps the fintech should take or watch.`,
    '  - citations: array of strings. EACH citation MUST be an EXACT verbatim substring of the SOURCE TEXT provided below.',
    '    Normalisation rule: citations are compared after collapsing whitespace and lowercasing.',
    '    DO NOT paraphrase, reword, or compose citations — copy them character-for-character from the source.',
    '    DO NOT invent citations that are not present in the source text.',
    '',
    'SECURITY RULES:',
    '  - NEVER include organizationId, userId, email, or any tenant identifier in the output.',
    '  - NEVER fabricate information not present in the alert.',
    '  - Output ONLY the JSON object — no markdown fences, no prose, no commentary.',
    '',
    `TOPIC: ${alert.topic}`,
    `SEVERITY: ${alert.severity}`,
    `TITLE: ${alert.title}`,
    '',
    `SOURCE TEXT (citations must be verbatim substrings of this):`,
    alert.summary,
    '',
    `Return the JSON object now. All prose in ${langLabel}.`,
  ];

  return lines.join('\n');
}

/** Inline JSON Schema for Writer responseSchema (structured output). */
function buildResponseSchema() {
  return {
    type: 'object',
    properties: {
      executiveSummary: { type: 'string' },
      whatChangesForYou: { type: 'string' },
      citations: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['executiveSummary', 'whatChangesForYou', 'citations'],
    additionalProperties: false,
  };
}

/** Raw result from a single Gemini Writer call (pre-Zod). */
export interface WriterRawResult {
  rawText: string;
  tokensIn: number;
  tokensOut: number;
}

/** Callable Writer agent produced by the factory. */
export interface WriterAgent {
  readonly model: string;
  /**
   * Invoke Gemini and return the raw response text + token counts.
   * Does NOT parse or validate — `runWriter` handles that.
   */
  call(
    alert: { title: string; summary: string; topic: string; severity: string },
    language: OutputLanguage,
  ): Promise<WriterRawResult>;
}

export interface BuildWriterAgentOpts {
  /** Override model id (default: `gemini-2.5-flash`). */
  model?: string;
}

/**
 * Create the Writer agent factory backed by a Gemini client.
 *
 * Pattern mirrors `createClassifierAgentFactory`:
 *   `const factory = createWriterAgentFactory(client)`
 *   `const agent = factory(opts)`
 *   `const raw = await agent.call(alert, language)`
 *
 * Pure factory — does NOT do I/O at construction time (safe for DI bootstrap).
 * Inject the result as `WRITER_AGENT_FACTORY` token.
 */
export function createWriterAgentFactory(client: GoogleGenAI) {
  return function build(opts: BuildWriterAgentOpts = {}): WriterAgent {
    const model = opts.model ?? DEFAULT_MODEL;

    return {
      model,
      async call(alert, language) {
        const prompt = buildWriterPrompt(alert, language);
        const response = await client.models.generateContent({
          model,
          contents: prompt,
          config: {
            // responseSchema for structured output. Do NOT add googleSearch —
            // incompatible with responseSchema (400 from Gemini API).
            responseMimeType: 'application/json',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            responseSchema: buildResponseSchema() as any,
            temperature: 0,
          },
        });

        const rawText = response.text ?? '';
        const usage = response.usageMetadata ?? {};

        return {
          rawText,
          tokensIn: Number(usage.promptTokenCount ?? 0),
          tokensOut: Number(usage.candidatesTokenCount ?? 0),
        };
      },
    };
  };
}

export type WriterAgentFactory = ReturnType<typeof createWriterAgentFactory>;
