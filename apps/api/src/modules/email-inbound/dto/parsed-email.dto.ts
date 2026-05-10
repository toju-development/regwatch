/**
 * Parsed email DTO — shape of the SendGrid Inbound Parse multipart payload.
 *
 * sdd/email-inbound REQ-3 (org resolution via `to`), REQ-4 (alert creation).
 *
 * SendGrid Inbound Parse sends a `multipart/form-data` POST where text fields
 * carry the parsed email parts. The fields we care about:
 *   - `to`       — original SMTP To (string, e.g. "slug@inbound.regwatch.io")
 *   - `from`     — sender address
 *   - `subject`  — email subject → Alert.title
 *   - `text`     — plain text body
 *   - `html`     — HTML body (optional; stripped if `text` absent)
 *   - `headers`  — raw RFC-2822 headers block; we extract `Message-ID` from it
 *   - `envelope` — JSON string: `{ to: string[], from: string }`
 */
import { z } from 'zod';

export interface ParsedEmailDto {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  /** Raw RFC-2822 headers block — Message-ID extracted via regex. */
  headers: string;
  /** JSON string: `{ to: string[], from: string }` */
  envelope: string;
}

export const ParsedEmailDtoSchema = z.object({
  to: z.string(),
  from: z.string(),
  subject: z.string().default(''),
  text: z.string().default(''),
  html: z.string().default(''),
  headers: z.string().default(''),
  envelope: z.string().default('{}'),
});
