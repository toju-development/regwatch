/**
 * `/settings` index — minimal landing page that links to each settings
 * sub-surface. Created as part of B5 (jurisdictions-config) because
 * `/settings/members` was previously the only settings page and there
 * was no parent shell.
 *
 * Spec: `sdd/jurisdictions-config/spec` § R-Settings-Preferences-Page
 *   (the new `/settings/preferences` surface needs a discoverable nav
 *   entry from the settings root).
 *
 * Future settings surfaces append a row here. No sidebar (yet) — when
 * the dashboard grows a sidebar, this index can be folded into it.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const SETTINGS_LINKS: ReadonlyArray<{ href: string; label: string; description: string }> = [
  {
    href: '/settings/members',
    label: 'Members',
    description: 'Invite teammates and manage roles.',
  },
  {
    href: '/settings/preferences',
    label: 'Preferences',
    description: 'Pick jurisdictions and configure scan cadence.',
  },
  {
    href: '/settings/usage',
    label: 'Usage',
    description: 'Monthly LLM cost vs the $10/mo cap.',
  },
  {
    href: '/settings/notifications',
    label: 'Notifications',
    description: 'Manage Slack, Teams and Email alert channels.',
  },
  {
    href: '/settings/billing',
    label: 'Billing',
    description: 'Manage your plan and Stripe subscription.',
  },
];

export default async function SettingsIndexPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8" data-testid="settings-index-page">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage your organization configuration.</p>
      </header>
      <ul className="flex flex-col gap-2">
        {SETTINGS_LINKS.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="hover:bg-muted block rounded-md border px-4 py-3 transition-colors"
              data-testid={`settings-index-link-${link.href.split('/').pop()}`}
            >
              <div className="font-medium">{link.label}</div>
              <div className="text-muted-foreground text-sm">{link.description}</div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
