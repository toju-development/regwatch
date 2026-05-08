/**
 * NavLinks — active-aware navigation links for the dashboard layout.
 *
 * Spec: sdd/dashboard-mvp/spec — web/layout domain.
 * Design: needs `usePathname` (client hook) — extracted from the RSC layout
 *   into a minimal client component to avoid forcing the whole layout client.
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/settings', label: 'Settings' },
] as const;

export function NavLinks(): React.ReactElement {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1" data-testid="nav-links">
      {NAV_LINKS.map(({ href, label }) => {
        // Active: exact match for /dashboard; prefix match for /alerts, /settings
        const isActive = href === '/dashboard' ? pathname === href : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
            )}
            data-testid={`nav-link-${label.toLowerCase()}`}
            aria-current={isActive ? 'page' : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
