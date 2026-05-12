/**
 * Client component for the "Upgrade to Pro" button on the billing page.
 * Calls the `createCheckoutSession` Server Action on click.
 *
 * sdd/billing-stripe POST-9.
 */
'use client';

import { useTransition } from 'react';
import { createCheckoutSession } from './actions';

interface BillingUpgradeButtonProps {
  orgId: string;
}

export function BillingUpgradeButton({ orgId }: BillingUpgradeButtonProps): React.ReactElement {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await createCheckoutSession(orgId);
      if (!result.ok) {
        // Action returns only on error; success redirects via redirect()
        alert(`Failed to start checkout: ${result.error}`);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      data-testid="billing-upgrade-button"
      className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
    >
      {isPending ? 'Redirecting to Stripe…' : 'Upgrade to Pro'}
    </button>
  );
}
