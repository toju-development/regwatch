/**
 * Unit tests for `<OnboardingWizard>`.
 *
 * Spec: `sdd/onboarding-flow/spec` — "Three-step client stepper":
 *   - Renders Step 1 initially with correct indicator
 *   - Advances to step 2 when StepJurisdictions calls onNext
 *   - Advances to step 3 when StepSlack calls onNext
 *   - Calls completeOnboardingAction(orgId) and router.push('/dashboard') on finish
 *
 * Mocks:
 *   - `../actions.js` → completeOnboardingAction
 *   - `next/navigation` → useRouter
 *   - Step sub-components — simple stubs that expose only the onNext/onFinish callbacks,
 *     avoiding the deep dependency tree (PreferencesForm, InviteMemberForm, etc.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const completeOnboardingAction = vi.fn();
const routerPush = vi.fn();

vi.mock('../actions.js', () => ({
  completeOnboardingAction: (...a: unknown[]) => completeOnboardingAction(...a),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

// Minimal stubs — expose only the callback the wizard wires up.
vi.mock('../step-jurisdictions.js', () => ({
  StepJurisdictions: ({ onNext }: { onNext: () => void }) => (
    <button data-testid="mock-step-jurisdictions-next" onClick={onNext}>
      jurisdictions-next
    </button>
  ),
}));

vi.mock('../step-slack.js', () => ({
  StepSlack: ({ onNext }: { onNext: () => void }) => (
    <button data-testid="mock-step-slack-next" onClick={onNext}>
      slack-next
    </button>
  ),
}));

vi.mock('../step-invitations.js', () => ({
  StepInvitations: ({ onFinish }: { onFinish: () => void }) => (
    <button data-testid="mock-step-invitations-finish" onClick={onFinish}>
      invitations-finish
    </button>
  ),
}));

import { OnboardingWizard } from '../onboarding-wizard.js';

const INITIAL_SETTINGS = {
  jurisdictions: [],
  scanSchedule: 'weekly' as const,
  scanDay: 'mon',
  scanHour: 8,
};

beforeEach(() => {
  completeOnboardingAction.mockReset();
  routerPush.mockReset();
  completeOnboardingAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  // cleanup() is called globally via vitest-setup
});

describe('<OnboardingWizard>', () => {
  it('renders step 1 (Jurisdictions) initially with step indicator "Step 1 / 3"', () => {
    render(
      <OnboardingWizard orgId="org-1" initialSettings={INITIAL_SETTINGS} initialChannel={null} />,
    );

    expect(screen.getByTestId('onboarding-wizard-step-indicator')).toHaveTextContent('Step 1 / 3');
    expect(screen.getByTestId('mock-step-jurisdictions-next')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-step-slack-next')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-step-invitations-finish')).not.toBeInTheDocument();
  });

  it('shows 3 step dots, first active', () => {
    render(
      <OnboardingWizard orgId="org-1" initialSettings={INITIAL_SETTINGS} initialChannel={null} />,
    );

    expect(screen.getByTestId('onboarding-wizard-dot-0')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-wizard-dot-1')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-wizard-dot-2')).toBeInTheDocument();
  });

  it('advances to step 2 when StepJurisdictions calls onNext', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingWizard orgId="org-1" initialSettings={INITIAL_SETTINGS} initialChannel={null} />,
    );

    await user.click(screen.getByTestId('mock-step-jurisdictions-next'));

    expect(screen.getByTestId('onboarding-wizard-step-indicator')).toHaveTextContent('Step 2 / 3');
    expect(screen.getByTestId('mock-step-slack-next')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-step-jurisdictions-next')).not.toBeInTheDocument();
  });

  it('advances to step 3 when StepSlack calls onNext', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingWizard orgId="org-1" initialSettings={INITIAL_SETTINGS} initialChannel={null} />,
    );

    await user.click(screen.getByTestId('mock-step-jurisdictions-next'));
    await user.click(screen.getByTestId('mock-step-slack-next'));

    expect(screen.getByTestId('onboarding-wizard-step-indicator')).toHaveTextContent('Step 3 / 3');
    expect(screen.getByTestId('mock-step-invitations-finish')).toBeInTheDocument();
  });

  it('calls completeOnboardingAction(orgId) and router.push("/dashboard") on finish', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingWizard orgId="org-1" initialSettings={INITIAL_SETTINGS} initialChannel={null} />,
    );

    await user.click(screen.getByTestId('mock-step-jurisdictions-next'));
    await user.click(screen.getByTestId('mock-step-slack-next'));
    await user.click(screen.getByTestId('mock-step-invitations-finish'));

    await waitFor(() => {
      expect(completeOnboardingAction).toHaveBeenCalledWith('org-1');
      expect(routerPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('does NOT advance beyond step 3 (step is capped)', async () => {
    const user = userEvent.setup();
    // Advance through all 3 steps.
    render(
      <OnboardingWizard orgId="org-1" initialSettings={INITIAL_SETTINGS} initialChannel={null} />,
    );

    await user.click(screen.getByTestId('mock-step-jurisdictions-next'));
    await user.click(screen.getByTestId('mock-step-slack-next'));

    // Still on step 3 indicator.
    expect(screen.getByTestId('onboarding-wizard-step-indicator')).toHaveTextContent('Step 3 / 3');
  });
});
