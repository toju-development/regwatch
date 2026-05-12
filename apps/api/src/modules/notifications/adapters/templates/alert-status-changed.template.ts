/**
 * alertStatusChangedTemplate — HTML email template for alert.status.changed events.
 *
 * sdd/notify-email-resend (POST-2) — task 4.2.
 *
 * Pure function (no DI). Returns { subject, html, text }.
 */

import type { AlertStatusChangedEvent } from '@regwatch/types';
import type { NotificationContext } from '@regwatch/types';
import { escapeHtml } from './html.utils.js';
import type { EmailTemplate } from './alert-concluded.template.js';

export function alertStatusChangedTemplate(
  payload: AlertStatusChangedEvent,
  ctx: NotificationContext,
): EmailTemplate {
  const subject = `Alert status changed: ${ctx.alertTitle}`;
  const safeTitle = escapeHtml(ctx.alertTitle);
  const safeOrg = escapeHtml(ctx.orgName);
  const safeActor = escapeHtml(ctx.actorName);
  const safeUrl = escapeHtml(ctx.alertUrl);
  const safeFromStatus = escapeHtml(payload.fromStatus ?? '—');
  const safeToStatus = escapeHtml(payload.toStatus);

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:sans-serif;color:#1a1a1a;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;">
    <h2 style="color:#3b82f6;margin-bottom:8px;">🔵 Alert status changed</h2>
    <p style="font-size:16px;font-weight:bold;margin:0 0 4px;">${safeTitle}</p>
    <p style="color:#6b7280;margin:0 0 16px;">${safeOrg}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:120px;">Status</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${safeFromStatus} → ${safeToStatus}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#6b7280;">Changed by</td>
        <td style="padding:8px 0;">${safeActor}</td>
      </tr>
    </table>
    <a href="${safeUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View alert →</a>
  </div>
</body>
</html>`;

  const text = `Alert status changed: ${ctx.alertTitle}\n\nOrganization: ${ctx.orgName}\nStatus: ${payload.fromStatus ?? '—'} → ${payload.toStatus}\nChanged by: ${ctx.actorName}\n\nView alert: ${ctx.alertUrl}`;

  return { subject, html, text };
}
