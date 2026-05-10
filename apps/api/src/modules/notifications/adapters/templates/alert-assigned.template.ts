/**
 * alertAssignedTemplate — HTML email template for alert.assigned events.
 *
 * sdd/notify-email-resend (POST-2) — task 4.3.
 *
 * Subject: "Alert assigned: {alertTitle}" — channel-based delivery,
 * not per-user (see constraints: "not 'to you'").
 *
 * Pure function (no DI). Returns { subject, html, text }.
 */

import type { AlertAssignedEvent } from '@regwatch/types';
import type { NotificationContext } from '@regwatch/types';
import type { EmailTemplate } from './alert-concluded.template.js';

export function alertAssignedTemplate(
  _payload: AlertAssignedEvent,
  ctx: NotificationContext,
): EmailTemplate {
  const assigneeLabel = ctx.assigneeName ?? 'Unassigned';
  const subject = `Alert assigned: ${ctx.alertTitle}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:sans-serif;color:#1a1a1a;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;">
    <h2 style="color:#3b82f6;margin-bottom:8px;">🔔 Alert assigned</h2>
    <p style="font-size:16px;font-weight:bold;margin:0 0 4px;">${ctx.alertTitle}</p>
    <p style="color:#6b7280;margin:0 0 16px;">${ctx.orgName}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:120px;">Assignee</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${assigneeLabel}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#6b7280;">Assigned by</td>
        <td style="padding:8px 0;">${ctx.actorName}</td>
      </tr>
    </table>
    <a href="${ctx.alertUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View alert →</a>
  </div>
</body>
</html>`;

  const text = `Alert assigned: ${ctx.alertTitle}\n\nOrganization: ${ctx.orgName}\nAssignee: ${assigneeLabel}\nAssigned by: ${ctx.actorName}\n\nView alert: ${ctx.alertUrl}`;

  return { subject, html, text };
}
