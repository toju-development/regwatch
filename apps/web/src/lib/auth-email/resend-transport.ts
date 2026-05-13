/**
 * Resend email transport for Magic Link sign-in.
 *
 * Spec: auth-foundation § auth — Magic Link Sign-in (R "Request → click → accept").
 * Design §6 (Q11). Operator decision #624: this transport is selected when
 * EMAIL_TRANSPORT=resend; dev/CI uses memory-transport.ts instead.
 *
 * Auth.js calls `sendVerificationRequest` with the magic link URL. We forward
 * it via Resend using a minimal HTML email template.
 *
 * Required env vars (validated at module load in auth.ts before this is called):
 *   AUTH_RESEND_KEY   — Resend API key (re_...)
 *   AUTH_EMAIL_FROM   — verified sender address (noreply@yourdomain.com)
 */
import type { EmailConfig } from 'next-auth/providers/email';
import { Resend } from 'resend';

/**
 * Build the Resend-backed email provider config object.
 *
 * IMPORTANT: `id` is set to `'resend'` (same as memory transport) so that
 * `signIn('resend', { email })` works regardless of which transport is active.
 * The Auth.js adapter still creates and consumes `VerificationToken` rows
 * because `type: 'email'` drives the standard email-provider machinery.
 *
 * @param apiKey   AUTH_RESEND_KEY value
 * @param fromEmail AUTH_EMAIL_FROM value
 */
export function resendEmailProvider(apiKey: string, fromEmail: string): EmailConfig {
  const resend = new Resend(apiKey);

  return {
    id: 'resend',
    type: 'email',
    name: 'Email (Resend)',
    from: fromEmail,
    maxAge: 60 * 60 * 24, // 24h — Auth.js default; preserved (R7).
    server: {},
    options: {},
    async sendVerificationRequest({
      identifier,
      url,
    }: {
      identifier: string;
      url: string;
    }): Promise<void> {
      const { error } = await resend.emails.send({
        from: fromEmail,
        to: identifier,
        subject: 'Tu link de acceso a RegWatch',
        html: buildEmailHtml(url),
        text: buildEmailText(url),
      });

      if (error) {
        throw new Error(`Resend sendVerificationRequest failed: ${error.message}`);
      }
    },
  } as EmailConfig;
}

function buildEmailHtml(url: string): string {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tu link de acceso a RegWatch</title>
</head>
<body style="font-family: sans-serif; background: #f9fafb; margin: 0; padding: 40px 16px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; margin: 0 auto;">
    <tr>
      <td style="background: #ffffff; border-radius: 12px; padding: 40px; border: 1px solid #e5e7eb;">
        <h1 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 8px;">
          RegWatch
        </h1>
        <p style="font-size: 14px; color: #6b7280; margin: 0 0 32px;">
          Monitoreo regulatorio inteligente
        </p>
        <p style="font-size: 15px; color: #374151; margin: 0 0 24px;">
          Hacé click en el botón para ingresar. El link expira en 24&nbsp;horas.
        </p>
        <a href="${url}"
           style="display: inline-block; background: #111827; color: #ffffff;
                  font-size: 15px; font-weight: 600; text-decoration: none;
                  padding: 12px 28px; border-radius: 8px;">
          Ingresar a RegWatch
        </a>
        <p style="font-size: 12px; color: #9ca3af; margin: 32px 0 0;">
          Si no solicitaste este link, podés ignorar este email.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();
}

function buildEmailText(url: string): string {
  return [
    'RegWatch — Monitoreo regulatorio inteligente',
    '',
    'Usá el siguiente link para ingresar (expira en 24 horas):',
    url,
    '',
    'Si no solicitaste este link, podés ignorar este email.',
  ].join('\n');
}
