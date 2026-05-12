/**
 * Server Actions for `/settings/billing`.
 *
 * Spec: `sdd/billing-stripe/spec` § 5. Web Billing Page — Checkout Server Action.
 * Design: `sdd/billing-stripe/design` § Data Flow.
 *
 * `createCheckoutSession(orgId)` calls `POST /billing/checkout` on apps/api
 * via `apiServerFetch`, then redirects the user to the Stripe-hosted Checkout URL.
 *
 * sdd/billing-stripe POST-9 — Task 4.2.
 */
'use server';

import { redirect } from 'next/navigation';
import { apiServerFetch } from '@/lib/api-server';

export interface CheckoutActionResult {
  ok: false;
  error: string;
}

/**
 * Creates a Stripe Checkout session for the Pro plan and redirects to the
 * Stripe-hosted Checkout URL.
 *
 * On success: calls `redirect(url)` — this throws internally (Next.js convention).
 * On failure: returns `{ ok: false, error }`.
 */
export async function createCheckoutSession(orgId: string): Promise<CheckoutActionResult> {
  let url: string;

  try {
    const res = await apiServerFetch('/billing/checkout', {
      method: 'POST',
      orgId,
      body: {},
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.status.toString());
      return { ok: false, error: `API error ${res.status}: ${text}` };
    }

    const data = (await res.json()) as { url?: string };
    if (!data.url) {
      return { ok: false, error: 'No checkout URL returned from API' };
    }
    url = data.url;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: msg };
  }

  // redirect() throws — must be called outside try/catch
  redirect(url);
}
