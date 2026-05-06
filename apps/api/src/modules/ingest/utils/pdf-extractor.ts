/**
 * PDF text extractor.
 *
 * sdd/manual-ingestion ADR-2: `pdf-parse` is the extraction backend.
 * No native bindings → Cloud Run safe. 10 MB cap enforced here BEFORE
 * calling pdf-parse; controller also enforces it at the HTTP boundary.
 *
 * Throws {@link PdfExtractionError} on:
 *   - Buffer exceeding 10 MB.
 *   - `pdf-parse` parse failure (corrupt / password-protected PDF).
 */

import * as pdfParseModule from 'pdf-parse';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;

/** Max PDF size: 10 MB */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Thrown when PDF extraction fails or the buffer exceeds the size limit.
 * Controller maps this to HTTP 422.
 */
export class PdfExtractionError extends Error {
  constructor(reason: string) {
    super(`PDF extraction failed: ${reason}`);
    this.name = 'PdfExtractionError';
  }
}

/**
 * Extract plain text from a PDF buffer.
 *
 * @param buffer - Raw PDF bytes.
 * @returns Extracted text string (may be empty for image-only PDFs).
 *
 * @throws {@link PdfExtractionError} if `buffer.length > MAX_PDF_BYTES`
 *   or if `pdf-parse` cannot parse the buffer.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_PDF_BYTES) {
    throw new PdfExtractionError(`PDF exceeds ${MAX_PDF_BYTES / 1024 / 1024} MB limit`);
  }

  try {
    const result = await pdfParse(buffer);
    return result.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PdfExtractionError(message);
  }
}
