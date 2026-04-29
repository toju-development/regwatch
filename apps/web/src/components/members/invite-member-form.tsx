/**
 * `<InviteMemberForm>` — client form to issue a new invitation.
 *
 * Spec: `sdd/org-invitations/spec`
 *   - R-Invitation-Issue ("OWNER/ADMIN issues invitation"; ADMIN cannot
 *     pick OWNER role; PERSONAL_ORG_NOT_INVITABLE; INVALID_EMAIL).
 *
 * Design: `sdd/org-invitations/design` §6 (frontend integration).
 *   - Email input + role picker (DropdownMenu — no Select primitive in
 *     `components/ui/`, same deviation as `<MemberRow>`).
 *   - `useTransition` for submit; on success clear inputs; on error
 *     surface inline message.
 *   - OWNER option disabled for ADMIN viewers (UI defense-in-depth;
 *     server enforces OWNER_INVITE_REQUIRES_OWNER).
 *
 * Foot-guns honoured:
 *   - `radix-dropdown-modal-default-causes-body-lock-with-rsc-rerender`:
 *     `<DropdownMenu modal={false}>`.
 */
'use client';

import { useState, useTransition } from 'react';
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

import { issueInvitationAction } from './actions';
import { describeInvitationActionError } from './pending-invitations-list';

/**
 * Roles offered in the invite form. OWNER appears here too (ADMIN
 * viewers see it disabled rather than hidden — gives them a hint that
 * the role exists but they can't grant it).
 */
const INVITE_ROLE_OPTIONS: ReadonlyArray<Role> = ['OWNER', 'ADMIN', 'ANALYST', 'VIEWER'];

const DEFAULT_ROLE: Role = 'VIEWER';

export interface InviteMemberFormProps {
  /** Org under which to issue the invitation. */
  orgId: string;
  /** Viewer's role IN `orgId` — drives the OWNER-option disabled state. */
  viewerRole: Role;
}

/**
 * UI-side gate: returns true if `target` is a role the viewer is NOT
 * permitted to assign. ADMIN cannot pick OWNER; the server is the
 * source of truth and would otherwise reject with
 * `OWNER_INVITE_REQUIRES_OWNER`.
 */
function isInviteRoleDisabled(target: Role, viewerRole: Role): boolean {
  if (viewerRole === 'ADMIN' && target === 'OWNER') return true;
  return false;
}

export function InviteMemberForm({ orgId, viewerRole }: InviteMemberFormProps): React.ReactElement {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(DEFAULT_ROLE);
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function handleRoleSelect(next: Role): void {
    if (isInviteRoleDisabled(next, viewerRole)) return;
    setRole(next);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    const trimmed = email.trim();
    if (trimmed === '') {
      setErrorMsg('Enter an email address.');
      return;
    }
    startTransition(async () => {
      const result = await issueInvitationAction(orgId, trimmed, role);
      if (!result.ok) {
        setErrorMsg(describeInvitationActionError(result));
        return;
      }
      setSuccessMsg(`Invitation sent to ${result.invitation?.email ?? trimmed}.`);
      setEmail('');
      setRole(DEFAULT_ROLE);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border p-4"
      data-testid="invite-member-form"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="invite-member-email" className="text-sm font-medium">
          Invite by email
        </label>
        <p className="text-muted-foreground text-xs">
          We&apos;ll email a sign-in link they can use to join.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          id="invite-member-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          placeholder="teammate@example.com"
          className="border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm"
          data-testid="invite-member-form-email"
        />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              data-testid="invite-member-form-role-trigger"
            >
              {role}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Role</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {INVITE_ROLE_OPTIONS.map((r) => (
              <DropdownMenuItem
                key={r}
                disabled={isInviteRoleDisabled(r, viewerRole)}
                onSelect={(event) => {
                  event.preventDefault();
                  handleRoleSelect(r);
                }}
                data-testid={`invite-member-form-role-option-${r}`}
                data-active={r === role ? 'true' : 'false'}
                data-disabled={isInviteRoleDisabled(r, viewerRole) ? 'true' : 'false'}
              >
                {r}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="submit" disabled={pending} data-testid="invite-member-form-submit">
          {pending ? 'Sending…' : 'Send invitation'}
        </Button>
      </div>
      {errorMsg ? (
        <p role="alert" className="text-destructive text-sm" data-testid="invite-member-form-error">
          {errorMsg}
        </p>
      ) : null}
      {successMsg ? (
        <p
          role="status"
          className="text-muted-foreground text-sm"
          data-testid="invite-member-form-success"
        >
          {successMsg}
        </p>
      ) : null}
    </form>
  );
}
