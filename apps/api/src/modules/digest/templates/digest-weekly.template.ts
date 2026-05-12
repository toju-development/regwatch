/**
 * digestWeeklyTemplate — HTML email for the weekly digest.
 *
 * sdd/digest-export (POST-3) — task 3.1/3.2/3.3.
 *
 * Pure function (no DI). Returns { subject, html, text }.
 * HTML is inline-styled for broad email client compatibility.
 * Follows the same pattern as alertConcludedTemplate (POST-2).
 *
 * Spec: subject = "RegWatch weekly digest — {orgName}".
 *       Alerts grouped by jurisdiction; null already resolved to "Unclassified" by caller.
 */

import type { DigestAlert } from '../digest.repository.js';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface DigestGroup {
  jurisdiction: string;
  alerts: DigestAlert[];
}

export interface DigestTemplateData {
  orgName: string;
  windowStart: Date;
  windowEnd: Date;
  groups: DigestGroup[];
}

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function digestWeeklyTemplate(data: DigestTemplateData): EmailTemplate {
  const { orgName, windowStart, windowEnd, groups } = data;
  const subject = `RegWatch weekly digest — ${orgName}`;

  const totalAlerts = groups.reduce((acc, g) => acc + g.alerts.length, 0);

  const groupHtml = groups
    .map((g) => {
      const rows = g.alerts
        .map(
          (a) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(a.title)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">
          <span style="background:#f3f4f6;border-radius:4px;padding:2px 6px;font-size:12px;font-weight:600;">${escapeHtml(a.status)}</span>
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px;">${escapeHtml(g.jurisdiction)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px;">${formatDate(a.detectedAt)}</td>
      </tr>`,
        )
        .join('');

      return `
    <h3 style="font-size:14px;color:#374151;margin:20px 0 6px;">${escapeHtml(g.jurisdiction)}</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:6px 8px;text-align:left;font-weight:600;color:#6b7280;font-size:12px;">Title</th>
          <th style="padding:6px 8px;text-align:left;font-weight:600;color:#6b7280;font-size:12px;">Status</th>
          <th style="padding:6px 8px;text-align:left;font-weight:600;color:#6b7280;font-size:12px;">Jurisdiction</th>
          <th style="padding:6px 8px;text-align:left;font-weight:600;color:#6b7280;font-size:12px;">Detected</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:sans-serif;color:#1a1a1a;margin:0;padding:24px;">
  <div style="max-width:640px;margin:0 auto;">
    <h2 style="color:#2563eb;margin-bottom:4px;">📋 Weekly Digest</h2>
    <p style="font-size:16px;font-weight:bold;margin:0 0 4px;">${escapeHtml(orgName)}</p>
    <p style="color:#6b7280;margin:0 0 16px;font-size:13px;">
      Period: ${formatDate(windowStart)} – ${formatDate(windowEnd)} · ${totalAlerts} alert${totalAlerts !== 1 ? 's' : ''}
    </p>
    ${groupHtml}
    <p style="color:#9ca3af;font-size:12px;margin-top:32px;">You are receiving this because you are an owner of ${escapeHtml(orgName)} on RegWatch.</p>
  </div>
</body>
</html>`;

  const groupText = groups
    .map((g) => {
      const alertLines = g.alerts
        .map((a) => `  - [${a.status}] ${a.title} (${formatDate(a.detectedAt)})`)
        .join('\n');
      return `${g.jurisdiction}:\n${alertLines}`;
    })
    .join('\n\n');

  const text = `RegWatch weekly digest — ${orgName}\nPeriod: ${formatDate(windowStart)} – ${formatDate(windowEnd)}\n\n${groupText}\n\n---\nYou are receiving this because you are an owner of ${orgName} on RegWatch.`;

  return { subject, html, text };
}
