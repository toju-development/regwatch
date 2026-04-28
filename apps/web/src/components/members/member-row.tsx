/**
 * `<MemberRow>` — client component, one row in the members table.
 *
 * Spec: `sdd/org-members/spec`
 *   - R-Membership-Update ("Self-promote rejected", "Self-downgrade
 *     allowed", role-change matrix) — UI surfaces server error codes
 *     verbatim via toasts.
 *   - R-Membership-Remove (admin-removes-other; self-leave handled by
 *     `<LeaveOrgButton>` in the page header, NOT here).
 *
 * Design: `sdd/org-members/design` §0 #10 ("Role select dropdown — `Select`
 *   `modal={false}` mandatory") + §6 (optimistic update via `useTransition`
 *   with rollback on rejection).
 *
 * Foot-guns honoured:
 *   - #672 (radix dropdown body-lock under RSC re-render): the role
 *     picker is a `<DropdownMenu modal={false}>`. Design originally
 *     specified shadcn `<Select>`, but `apps/web/src/components/ui/`
 *     does not ship a Select primitive — DropdownMenu carries identical
 *     "select-from-list" semantics, satisfies #672, and matches the
 *     pattern already used by `<OrgSwitcher>`.
 *
 * Why client:
 *   - `useTransition` for optimistic role updates with rollback.
 *   - `<DropdownMenu>` and `<Dialog>` are client primitives.
 *   - Calls server actions imported from `./actions.js`.
 *
 * Optimistic flow (role change):
 *   1. User picks a new role from the dropdown.
 *   2. Local `optimisticRole` flips immediately so the cell paints fresh.
 *   3. `startTransition(async () => { await updateMemberRoleAction(...) })`.
 *   4. On `{ ok: false }`, roll back `optimisticRole` to the prop value
 *      and surface the error via the `onError` callback (page-level
 *      toast). On `{ ok: true }`, the server action calls
 *      `revalidatePath('/settings/members')` so the RSC re-fetches and
 *      the prop arrives with the new value — `optimisticRole` is reset
 *      to `null` on the next render via `key`-style identity (we re-
 *      derive the displayed role from `member.role ?? optimisticRole`).
 *
 * Remove flow:
 *   1. Kebab menu → "Remove member" item opens `<RemoveMemberDialog>`.
 *   2. Dialog confirm calls `removeMemberAction(orgId, userId)`.
 *   3. On success, dialog closes and `revalidatePath` updates the list.
 *   4. On error, dialog stays open with the error message (passed as a
 *      prop down from this row).
 *
 * Self-row affordance:
 *   - "(you)" badge next to the email.
 *   - Role select still rendered for self-downgrade (Q8). Server enforces
 *     `SELF_PROMOTE_FORBIDDEN`; the dropdown does NOT pre-filter to
 *     downgrades because the role hierarchy is small and the server is
 *     the source of truth. We surface the 403 code as a toast.
 *   - Remove control is hidden on the self row (use `<LeaveOrgButton>`
 *     in the page header instead — it adds the active-org switch).
 */
'use client';

import { useState, useTransition } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { Role } from '@regwatch/types';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { updateMemberRoleAction } from './actions';
import type { MembersActionResult } from './actions';
import { RemoveMemberDialog } from './remove-member-dialog';

/**
 * Wire shape for one row — mirrors `MemberListEntryDto` from
 * `apps/api/src/modules/members/members.controller.ts`. Re-declared in
 * the web layer so the component types do NOT take a transitive dep on
 * `apps/api` types (there is no shared package today; future MVP-3b3b
 * may consolidate via `@regwatch/types`).
 */
export interface MemberRowData {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  joinedAt: string;
  isPersonalOrgOwner: boolean;
}

const ROLE_ORDER: ReadonlyArray<Role> = ['OWNER', 'ADMIN', 'ANALYST', 'VIEWER'];

export interface MemberRowProps {
  /** Org id for the mutation actions. */
  orgId: string;
  /** Member entry from the `GET /org/:orgId/members` response. */
  member: MemberRowData;
  /** True when this row represents the current viewer. */
  isSelf: boolean;
  /** True when the viewer is OWNER or ADMIN — gates mutation controls. */
  canManage: boolean;
  /** Viewer's role IN `orgId` — used to gate ADMIN-vs-OWNER promotion UI hints. */
  viewerRole: Role;
}

/**
 * Translate a {@link MembersActionResult} `code` to a user-facing string.
 * Centralised so the row + leave-org button render the same copy for
 * the same server outcome. Non-exhaustive — falls back to `error` text.
 */
export function describeActionError(result: MembersActionResult): string {
  switch (result.code) {
    case 'LAST_OWNER':
      return 'Cannot remove the last OWNER of this organization.';
    case 'PERSONAL_ORG_UNREMOVABLE':
      return 'You cannot leave or remove members from a personal organization.';
    case 'OWNER_PROMOTE_REQUIRES_OWNER':
      return 'Only an OWNER can promote a member to OWNER.';
    case 'SELF_PROMOTE_FORBIDDEN':
      return 'You cannot promote yourself; only downgrades are allowed.';
    case 'OWNER_REMOVE_REQUIRES_OWNER':
      return 'Only an OWNER can remove another OWNER.';
    case 'STALE_MEMBERSHIPS':
      return 'Your session is out of date. Please refresh and try again.';
    case 'UNAUTHENTICATED':
      return 'Your session has expired. Please sign in again.';
    case 'FORBIDDEN':
      return 'You are not allowed to perform this action.';
    case 'NOT_FOUND':
      return 'Member not found.';
    case 'BAD_REQUEST':
      return result.error ?? 'Invalid request.';
    default:
      return result.error ?? 'An unexpected error occurred.';
  }
}

export function MemberRow({
  orgId,
  member,
  isSelf,
  canManage,
}: MemberRowProps): React.ReactElement {
  const [optimisticRole, setOptimisticRole] = useState<Role | null>(null);
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  // The role we actually paint: optimistic when set, otherwise prop.
  const displayedRole = optimisticRole ?? member.role;

  // Role picker is shown when:
  //   - Viewer can manage AND target is not self → cross-user role change.
  //   - Target IS self → self-downgrade (Q8) is allowed; server enforces
  //     `SELF_PROMOTE_FORBIDDEN` for upgrades.
  // Always disabled on the personal-org-owner row of a personal org —
  // but we don't have `isPersonalOrg` on the org metadata at this layer
  // (only `isPersonalOrgOwner` on the member). The server returns
  // `PERSONAL_ORG_UNREMOVABLE` for any mutation against the personal-org
  // owner pair. We render the picker; if the user tries an illegal
  // change we surface the error.
  const showRolePicker = canManage || isSelf;

  function handleRoleChange(next: Role): void {
    if (next === displayedRole) return;
    const previous = displayedRole;
    setOptimisticRole(next);
    setErrorMsg(null);
    startTransition(async () => {
      const result = await updateMemberRoleAction(orgId, member.userId, next);
      if (!result.ok) {
        setOptimisticRole(previous === member.role ? null : previous);
        setErrorMsg(describeActionError(result));
      }
      // On success, revalidatePath will re-fetch — the new prop value
      // will arrive and we can drop the optimistic override.
      if (result.ok) {
        setOptimisticRole(null);
      }
    });
  }

  return (
    <tr data-testid={`member-row-${member.userId}`} data-self={isSelf ? 'true' : 'false'}>
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="font-medium">{member.name ?? member.email}</span>
          {member.name ? (
            <span className="text-muted-foreground text-xs">{member.email}</span>
          ) : null}
          {isSelf ? (
            <span
              className="text-muted-foreground mt-0.5 text-xs uppercase"
              data-testid={`member-row-self-${member.userId}`}
            >
              you
            </span>
          ) : null}
          {errorMsg ? (
            <span
              role="alert"
              className="text-destructive mt-1 text-xs"
              data-testid={`member-row-error-${member.userId}`}
            >
              {errorMsg}
            </span>
          ) : null}
        </div>
      </td>

      <td className="px-4 py-3">
        {showRolePicker ? (
          // `modal={false}` per #672 — RSC re-render after revalidatePath
          // can race the dropdown close animation; modal=true would leave
          // <body> with `pointer-events: none`.
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                data-testid={`member-row-role-trigger-${member.userId}`}
              >
                {displayedRole}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Change role</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ROLE_ORDER.map((r) => (
                <DropdownMenuItem
                  key={r}
                  onSelect={(event) => {
                    event.preventDefault();
                    handleRoleChange(r);
                  }}
                  data-testid={`member-row-role-option-${member.userId}-${r}`}
                  data-active={r === displayedRole ? 'true' : 'false'}
                >
                  {r}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span data-testid={`member-row-role-readonly-${member.userId}`}>{displayedRole}</span>
        )}
      </td>

      <td className="text-muted-foreground px-4 py-3 text-xs">
        {new Date(member.joinedAt).toLocaleDateString()}
      </td>

      <td className="px-4 py-3 text-right">
        {canManage && !isSelf ? (
          <>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Member actions"
                  disabled={pending}
                  data-testid={`member-row-menu-${member.userId}`}
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={(event) => {
                    event.preventDefault();
                    setRemoveOpen(true);
                  }}
                  data-testid={`member-row-remove-trigger-${member.userId}`}
                >
                  Remove member
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <RemoveMemberDialog
              orgId={orgId}
              member={member}
              open={removeOpen}
              onOpenChange={setRemoveOpen}
              onError={(msg) => setErrorMsg(msg)}
            />
          </>
        ) : null}
      </td>
    </tr>
  );
}
