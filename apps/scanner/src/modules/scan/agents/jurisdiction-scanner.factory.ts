/**
 * Per-jurisdiction `JurisdictionScanner` factory.
 *
 * Builds the equivalent of an ADK `LlmAgent` that wraps a single Gemini 2.5 Flash
 * call with `googleSearch` grounding and structured-output coercion via prompt +
 * Zod validation (NOT `responseSchema`, see KNOWN FOOT-GUN below).
 *
 * Spec: sdd/scanner-vertical-ar/spec R-1-AdkTopology, R-2-Sources, R-9-FailFastPerSource.
 * Design: sdd/scanner-vertical-ar/design ADR-2 (ADK topology — googleSearch ONLY tool).
 *
 * KNOWN FOOT-GUN (Gemini API):
 *   The Gemini API does NOT allow `tools:[{googleSearch:{}}]` AND
 *   `responseSchema` simultaneously (mutually exclusive — server returns 400
 *   "Tool use with structured output is not supported").
 *   Workaround MVP-5: use `googleSearch` for grounding + a strict prompt that
 *   instructs the model to emit a fenced JSON block matching `ScanResultSchema`,
 *   then JSON-parse and Zod-validate the response text (defense-in-depth).
 *   Saved to engram as `regwatch/footguns/gemini-googlesearch-vs-responseschema`.
 *
 * Returns a deterministic, mockable interface so unit tests don't hit the network.
 */
import type { GoogleGenAI } from '@google/genai';

import { ScanResultSchema, type Finding, type SourceSpec } from './finding.schema.js';

/** Token usage echoed by Gemini `response.usageMetadata`. Numbers, not Decimal. */
export interface AgentUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

/** What a JurisdictionScanner returns to the RootAgent / ScanService. */
export interface JurisdictionScanResult {
  findings: Finding[];
  usageMetadata: AgentUsageMetadata;
  rawText: string;
}

export interface JurisdictionScanner {
  readonly jurisdiction: string;
  readonly model: string;
  readonly sources: readonly SourceSpec[];
  run(opts?: { sinceDate?: Date; customTopics?: string }): Promise<JurisdictionScanResult>;
}

export interface BuildJurisdictionScannerOpts {
  jurisdiction: string;
  sources: readonly SourceSpec[];
  /** Override model id (default `gemini-2.5-flash`). */
  model?: string;
}

const DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Build the system prompt + user query that asks Gemini for a JSON block.
 * Exposed for unit tests so prompt drift is detectable.
 */
export function buildPrompt(
  jurisdiction: string,
  sources: readonly SourceSpec[],
  opts?: { sinceDate?: Date; customTopics?: string },
): { systemInstruction: string; userText: string } {
  const sinceLine = opts?.sinceDate
    ? `Only include items published on or after ${opts.sinceDate.toISOString().slice(0, 10)}.`
    : 'Prefer items published in the last 7 days.';
  const topicsLine = opts?.customTopics ? `Focus on these topics first: ${opts.customTopics}.` : '';

  const sourceList = sources
    .map(
      (s, i) =>
        `${i + 1}. ${s.regulator} — ${s.displayName} | seed: ${s.searchUrl} | host: ${s.baseDomain}`,
    )
    .join('\n');

  const systemInstruction = [
    'You are a regulatory-watch analyst.',
    'Your job: discover NEW regulatory updates from official regulator websites.',
    'You MUST use Google Search grounding to find current information.',
    'You MUST output ONLY a single JSON object — no prose, no markdown fences, no commentary.',
    'The JSON object MUST match this TypeScript shape:',
    '  { "findings": Array<{',
    `      "source": ${sources.map((s) => `"${s.regulator}"`).join(' | ')},`,
    '      "sourceUrl": string (absolute https URL on the regulator domain),',
    '      "title": string (3-500 chars),',
    '      "summary": string (max 2000 chars),',
    '      "publishedAt"?: string (ISO 8601)',
    '    }> }',
    'Cap output at 50 findings. If nothing found, return { "findings": [] }.',
    'NEVER fabricate URLs — only return URLs returned by the search tool.',
    'NEVER include an `organizationId` or any tenant identifier — the caller controls that.',
  ].join('\n');

  const userText = [
    `Jurisdiction: ${jurisdiction}`,
    sinceLine,
    topicsLine,
    'Allowed sources:',
    sourceList,
    '',
    'Return the JSON object now.',
  ]
    .filter(Boolean)
    .join('\n');

  return { systemInstruction, userText };
}

/**
 * Strip optional ```json fences and parse the model output, then Zod-validate.
 * Throws if not parseable / not schema-conformant — caller turns into ScanLog.FAILED.
 */
export function parseFindingsFromText(rawText: string): Finding[] {
  const trimmed = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const parsed = JSON.parse(trimmed) as unknown;
  const result = ScanResultSchema.parse(parsed);
  return result.findings;
}

/**
 * Construct a JurisdictionScanner backed by a Gemini client. Pure factory —
 * does NOT do I/O at construction time (safe for DI bootstrap).
 */
export function createJurisdictionScannerFactory(client: GoogleGenAI) {
  return function build(opts: BuildJurisdictionScannerOpts): JurisdictionScanner {
    const model = opts.model ?? DEFAULT_MODEL;
    const sources = opts.sources;
    const jurisdiction = opts.jurisdiction;

    return {
      jurisdiction,
      model,
      sources,
      async run(runOpts) {
        const { systemInstruction, userText } = buildPrompt(jurisdiction, sources, runOpts);
        const response = await client.models.generateContent({
          model,
          contents: userText,
          config: {
            systemInstruction,
            // googleSearch grounding tool — see KNOWN FOOT-GUN at top of file.
            tools: [{ googleSearch: {} }],
            temperature: 0,
          },
        });

        const rawText = response.text ?? '';
        const usage = response.usageMetadata ?? {};
        const usageMetadata: AgentUsageMetadata = {
          promptTokenCount: Number(usage.promptTokenCount ?? 0),
          candidatesTokenCount: Number(usage.candidatesTokenCount ?? 0),
          totalTokenCount: Number(usage.totalTokenCount ?? 0),
        };

        const findings = parseFindingsFromText(rawText);
        return { findings, usageMetadata, rawText };
      },
    };
  };
}

export type JurisdictionScannerFactory = ReturnType<typeof createJurisdictionScannerFactory>;
