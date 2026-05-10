/**
 * alertConcludedTemplate — HTML email template for alert.concluded events.
 *
 * sdd/notify-email-resend (POST-2) — task 4.1.
 *
 * Pure function (no DI). Returns { subject, html, text } ready to pass
 * to EmailPort.send(). HTML is inline-styled for broad email client compatibility.
 */

import type { AlertConcludedEvent } from '@regwatch/types';
import type { NotificationContext } from '@regwatch/types';

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export function alertConcludedTemplate(
  _payload: AlertConcludedEvent,
  ctx: NotificationContext,
): EmailTemplate {
  const subject = `Alert concluded: ${ctx.alertTitle}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:sans-serif;color:#1a1a1a;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;">
    <h2 style="color:#22c55e;margin-bottom:8px;">🟢 Alert concluded</h2>
    <p style="font-size:16px;font-weight:bold;margin:0 0 4px;">${ctx.alertTitle}</p>
    <p style="color:#6b7280;margin:0 0 16px;">${ctx.orgName}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:120px;">Concluded by</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${ctx.actorName}</td>
      </tr>
    </table>
    <a href="${ctx.alertUrl}" style="display:inline-block;background:#22c55e;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View alert →</a>
  </div>
</body>
</html>`;

  const text = `Alert concluded: ${ctx.alertTitle}\n\nOrganization: ${ctx.orgName}\nConcluded by: ${ctx.actorName}\n\nView alert: ${ctx.alertUrl}`;

  return { subject, html, text };
}
