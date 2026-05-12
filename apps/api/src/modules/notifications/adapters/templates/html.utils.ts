/**
 * Minimal HTML escaper for inline email templates.
 * Prevents HTML injection via user-controlled content (org names,
 * alert titles, actor names, etc.) interpolated into email bodies.
 *
 * Consistent with the same helper in apps/api/src/modules/email/email.listener.ts.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
