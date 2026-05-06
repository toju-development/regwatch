/**
 * Unit tests for `pdf-extractor.ts`.
 *
 * sdd/manual-ingestion B4.9:
 *   - Valid PDF buffer (mock pdf-parse) → returns string.
 *   - Corrupt buffer → PdfExtractionError.
 *   - Buffer > 10MB → PdfExtractionError BEFORE calling pdf-parse.
 */

import { describe, expect, it, vi } from 'vitest';
import { PdfExtractionError, extractPdfText, MAX_PDF_BYTES } from '../utils/pdf-extractor.js';

vi.mock('pdf-parse', () => ({
  default: vi.fn(),
}));

import pdfParse from 'pdf-parse';
const mockedPdfParse = vi.mocked(pdfParse);

describe('extractPdfText', () => {
  it('returns extracted text from a valid PDF buffer', async () => {
    mockedPdfParse.mockResolvedValueOnce({ text: 'extracted content', numpages: 1 } as Awaited<
      ReturnType<typeof pdfParse>
    >);

    const buffer = Buffer.from('fake-pdf-bytes');
    const result = await extractPdfText(buffer);

    expect(result).toBe('extracted content');
    expect(mockedPdfParse).toHaveBeenCalledWith(buffer);
  });

  it('throws PdfExtractionError when pdf-parse throws', async () => {
    mockedPdfParse.mockRejectedValueOnce(new Error('corrupt PDF'));

    const buffer = Buffer.from('not-a-pdf');
    const err = await extractPdfText(buffer).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfExtractionError);
    expect((err as PdfExtractionError).message).toContain('corrupt PDF');
  });

  it('throws PdfExtractionError BEFORE calling pdf-parse for buffers > 10MB', async () => {
    mockedPdfParse.mockClear();

    const oversized = Buffer.alloc(MAX_PDF_BYTES + 1);
    await expect(extractPdfText(oversized)).rejects.toThrow(PdfExtractionError);
    await expect(extractPdfText(oversized)).rejects.toThrow('10 MB limit');

    expect(mockedPdfParse).not.toHaveBeenCalled();
  });

  it('throws PdfExtractionError for a buffer exactly at the limit (boundary: OK)', async () => {
    mockedPdfParse.mockResolvedValueOnce({ text: 'ok', numpages: 1 } as Awaited<
      ReturnType<typeof pdfParse>
    >);

    const exactly = Buffer.alloc(MAX_PDF_BYTES);
    const result = await extractPdfText(exactly);
    expect(result).toBe('ok');
  });
});
