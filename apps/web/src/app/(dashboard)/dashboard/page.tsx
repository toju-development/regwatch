/**
 * `/dashboard` — minimal RSC entry that exists so the `(dashboard)`
 * route-group layout actually mounts on a real navigation.
 *
 * Spec: `sdd/org-membership-ux/spec` § R-Switcher (the layout this page
 *   triggers is what mounts `<OrgSwitcher>` per § R-Switcher S1/S2).
 *   Without a leaf page inside the `(dashboard)` group, no URL would
 *   ever cause the group's `layout.tsx` to render.
 *
 * Design: §1 architecture map (the dashboard surface) + §B6 (E2E
 *   coverage requires a stable URL to drive the switcher flow).
 *
 * The actual interactive surface lives in `<DashboardClient>` so the
 * page itself stays an RSC (auth + redirect handled in the layout).
 *
 * NO `pnpm build` (project rule).
 */
import { DashboardClient } from './dashboard-client';

export default function DashboardPage(): React.ReactElement {
  return <DashboardClient />;
}
