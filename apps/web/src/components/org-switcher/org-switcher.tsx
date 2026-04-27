/**
 * `<OrgSwitcher>` — the active-org dropdown affordance.
 *
 * Spec: `sdd/org-membership-ux/spec` § R-Switcher scenarios:
 *   - "Single membership → disabled control"
 *   - "Two memberships → dropdown switch"
 *   - "Create-new-org affordance"
 *   - "Active org highlighted"
 *
 * Design: §4 (switcher UI) + §6 (hydration gate) + decision #5
 *   ("Hybrid: RSC seeds, client mirrors").
 *
 * Behavior:
 *   - 1 membership → renders a disabled trigger labelled with the org
 *     slug. No dropdown opens. Tooltip-like `title` explains why.
 *   - 2+ memberships → renders a `<DropdownMenu>` listing all orgs.
 *     The active one is highlighted with a check icon. Selecting a
 *     different one fires `switchActiveOrg(orgId)` and optimistically
 *     updates the local store (server action will revalidate).
 *   - Footer "Create new organization" opens a `<Dialog>` with a single
 *     name field. Submitting calls `createOrgAction(name)`. On success,
 *     the client `await session.update()` to refresh the JWT (gains
 *     the new membership claim) then `switchActiveOrg(new.org.id)`.
 *
 * Hydration:
 *   - Reads `memberships`, `activeOrgId`, `hydrated` from `useActiveOrg`.
 *   - Renders a skeleton (a disabled placeholder) while `!hydrated` so
 *     the trigger label doesn't pop-in. The provider hydrates within a
 *     single tick so this is rarely visible.
 */
'use client';

import { useState, useTransition } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useSession } from 'next-auth/react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useActiveOrg } from '@/lib/active-org-store';

import { createOrgAction, switchActiveOrg } from './actions.js';

/**
 * Pure helper — derive the human label for a membership row. Centralised
 * so both the trigger label and the dropdown items stay consistent.
 * Today we only have `orgSlug` (the JWT claim does NOT carry org name).
 */
export function membershipLabel(m: { orgSlug: string }): string {
  return m.orgSlug;
}

export interface OrgSwitcherProps {
  /**
   * Optional className passthrough so callers in the dashboard layout
   * can size the trigger to fit the sidebar.
   */
  className?: string;
}

export function OrgSwitcher({ className }: OrgSwitcherProps): React.ReactElement {
  const memberships = useActiveOrg((s) => s.memberships);
  const activeOrgId = useActiveOrg((s) => s.activeOrgId);
  const hydrated = useActiveOrg((s) => s.hydrated);
  const setActive = useActiveOrg((s) => s.setActive);
  const setMemberships = useActiveOrg((s) => s.setMemberships);

  const session = useSession();

  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const activeMembership = memberships.find((m) => m.organizationId === activeOrgId) ?? null;
  const triggerLabel = !hydrated
    ? 'Loading…'
    : activeMembership
      ? membershipLabel(activeMembership)
      : memberships[0]
        ? membershipLabel(memberships[0])
        : 'No organization';

  // 1-membership disabled state. Per spec: the trigger renders but
  // cannot be opened; the title explains why.
  if (hydrated && memberships.length <= 1) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled
        title="You belong to a single organization"
        className={className}
        data-testid="org-switcher-trigger"
        data-disabled="true"
      >
        <span className="truncate">{triggerLabel}</span>
      </Button>
    );
  }

  function handleSelect(orgId: string): void {
    if (orgId === activeOrgId) return;
    // Optimistic local mirror — the server action will `revalidatePath`
    // so the RSC tree re-seeds the provider on next render.
    setActive(orgId);
    startTransition(async () => {
      const result = await switchActiveOrg(orgId);
      if (!result.ok) {
        // Roll back on failure. The provider will also re-seed on next
        // RSC render so this just keeps the optimistic state honest.
        setActive(activeOrgId);
      }
    });
  }

  async function handleCreateSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreateError(null);
    const name = createName.trim();
    if (name.length === 0) {
      setCreateError('Name is required');
      return;
    }

    const created = await createOrgAction(name);
    if (!created.ok || !created.org) {
      setCreateError(created.error ?? 'Failed to create organization');
      return;
    }

    // Refresh the NextAuth JWT so the new membership claim is on the
    // session. `update()` is a hook concern → must run client-side.
    await session.update?.();

    // Mirror the new membership into the local store immediately so the
    // dropdown shows it before the next RSC pass.
    setMemberships([
      ...memberships,
      {
        organizationId: created.org.id,
        orgSlug: created.org.slug,
        role: 'OWNER',
      },
    ]);

    const switched = await switchActiveOrg(created.org.id);
    if (!switched.ok) {
      setCreateError(switched.error ?? 'Created but failed to switch');
      return;
    }

    setCreateName('');
    setCreateOpen(false);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={className}
            disabled={pending}
            data-testid="org-switcher-trigger"
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronsUpDown className="ml-2 size-4 opacity-60" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuLabel>Switch organization</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {memberships.map((m) => {
            const isActive = m.organizationId === activeOrgId;
            return (
              <DropdownMenuItem
                key={m.organizationId}
                onSelect={(event) => {
                  event.preventDefault();
                  handleSelect(m.organizationId);
                }}
                data-testid={`org-switcher-item-${m.organizationId}`}
                data-active={isActive ? 'true' : 'false'}
              >
                <span className="flex-1 truncate">{membershipLabel(m)}</span>
                {isActive ? <Check className="ml-2 size-4" aria-hidden /> : null}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setCreateOpen(true);
            }}
            data-testid="org-switcher-create"
          >
            <Plus className="mr-2 size-4" aria-hidden />
            Create new organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={handleCreateSubmit} data-testid="org-switcher-create-form">
            <DialogHeader>
              <DialogTitle>Create organization</DialogTitle>
              <DialogDescription>
                Give your new organization a short, recognisable name.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <label className="block text-sm font-medium" htmlFor="org-name">
                Name
              </label>
              <input
                id="org-name"
                name="name"
                type="text"
                autoFocus
                required
                maxLength={80}
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                className="bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                data-testid="org-switcher-create-name"
              />
              {createError ? (
                <p
                  role="alert"
                  className="text-destructive mt-2 text-sm"
                  data-testid="org-switcher-create-error"
                >
                  {createError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" data-testid="org-switcher-create-submit">
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
