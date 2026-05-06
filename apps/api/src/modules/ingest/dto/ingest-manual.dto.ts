/**
 * Zod schema for `POST /ingest/manual` request body.
 *
 * sdd/manual-ingestion R-1 / R-2 / R-3: three input types sharing
 * `jurisdiction` (required) and optional `regulator`.
 *
 * PDF uploads arrive as multipart `file` — there is NO `type:'pdf'` variant
 * in this schema. The controller detects a PDF by the presence of
 * `@UploadedFile()` and dispatches to `IngestService.ingestPdf()` directly.
 *
 * Discriminator: `type` field  (`'url'` | `'text'`).
 *
 * Jurisdiction codes (MVP-7): `['AR','BR','CO','PE','CL']`.
 */

import { z } from 'zod';

const JURISDICTIONS = ['AR', 'BR', 'CO', 'PE', 'CL'] as const;

const jurisdictionField = z.enum(JURISDICTIONS);

/** Common fields shared by all variants. */
const baseFields = {
  jurisdiction: jurisdictionField,
  regulator: z.string().min(1).optional(),
};

/** URL variant — fetch content from a remote HTTPS URL. */
export const urlVariantSchema = z.object({
  type: z.literal('url'),
  url: z.string().url(),
  title: z.string().min(1).optional(),
  ...baseFields,
});

/** Text (paste) variant — submit raw text directly. */
export const textVariantSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
  title: z.string().min(1),
  ...baseFields,
});

/**
 * Discriminated union of all non-file ingestion variants.
 * Use `ingestManualSchema.parse(body)` in the controller.
 */
export const ingestManualSchema = z.discriminatedUnion('type', [
  urlVariantSchema,
  textVariantSchema,
]);

export type UrlIngestDto = z.infer<typeof urlVariantSchema>;
export type TextIngestDto = z.infer<typeof textVariantSchema>;
export type IngestManualDto = z.infer<typeof ingestManualSchema>;

/**
 * Minimal DTO for the PDF path — body fields aside from the file upload.
 * The `file` itself arrives via `@UploadedFile()`, not in the body schema.
 */
export const pdfMetaSchema = z.object({
  jurisdiction: jurisdictionField,
  regulator: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
});

export type PdfMetaDto = z.infer<typeof pdfMetaSchema>;
