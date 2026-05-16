/**
 * Unit tests para `<OnboardingModal>`.
 *
 * Los steps son stubs mínimos — exponen solo un marcador visible.
 * La navegación (Siguiente, Volver, Finalizar) y el guardado los centraliza el modal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const completeOnboardingAction = vi.fn();
const renameOrgAction = vi.fn();
const saveSettingsAction = vi.fn();
const saveSlackChannelAction = vi.fn();

vi.mock('../actions.js', () => ({
  completeOnboardingAction: (...a: unknown[]) => completeOnboardingAction(...a),
  renameOrgAction: (...a: unknown[]) => renameOrgAction(...a),
  saveSettingsAction: (...a: unknown[]) => saveSettingsAction(...a),
  saveSlackChannelAction: (...a: unknown[]) => saveSlackChannelAction(...a),
}));

const routerRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

// Stubs mínimos — solo renderizan un marcador visible.
vi.mock('../step-org-name.js', () => ({
  StepOrgName: () => <div data-testid="mock-step-org-name" />,
}));

vi.mock('../step-jurisdictions.js', () => ({
  StepJurisdictions: () => <div data-testid="mock-step-jurisdictions" />,
}));

vi.mock('../step-slack.js', () => ({
  StepSlack: () => <div data-testid="mock-step-slack" />,
}));

import { OnboardingModal } from '../onboarding-modal.js';

const DEFAULT_PROPS = {
  orgId: 'org-1',
  initialOrgName: 'Mi Org',
  initialJurisdictions: [],
  initialChannel: null,
};

beforeEach(() => {
  completeOnboardingAction.mockReset();
  renameOrgAction.mockReset();
  saveSettingsAction.mockReset();
  saveSlackChannelAction.mockReset();
  routerRefresh.mockReset();

  completeOnboardingAction.mockResolvedValue({ ok: true });
  renameOrgAction.mockResolvedValue({ ok: true });
  saveSettingsAction.mockResolvedValue({ ok: true });
  saveSlackChannelAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  // cleanup() global via vitest-setup
});

describe('<OnboardingModal>', () => {
  it('renderiza el Paso 1 (OrgName) inicialmente', () => {
    render(<OnboardingModal {...DEFAULT_PROPS} />);

    expect(screen.getByTestId('mock-step-org-name')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-step-jurisdictions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-step-slack')).not.toBeInTheDocument();
  });

  it('muestra el botón "Saltar configuración"', () => {
    render(<OnboardingModal {...DEFAULT_PROPS} />);
    expect(screen.getByTestId('onboarding-modal-skip-all')).toBeInTheDocument();
  });

  it('muestra 3 dots de pasos', () => {
    render(<OnboardingModal {...DEFAULT_PROPS} />);
    expect(screen.getByTestId('onboarding-modal-dot-0')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-modal-dot-1')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-modal-dot-2')).toBeInTheDocument();
  });

  it('no muestra "Volver" en el paso 1', () => {
    render(<OnboardingModal {...DEFAULT_PROPS} />);
    expect(screen.queryByTestId('onboarding-modal-back')).not.toBeInTheDocument();
  });

  it('avanza al Paso 2 al hacer click en Siguiente', async () => {
    const user = userEvent.setup();
    render(<OnboardingModal {...DEFAULT_PROPS} />);

    await user.click(screen.getByTestId('onboarding-modal-next'));

    expect(screen.getByTestId('mock-step-jurisdictions')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-step-org-name')).not.toBeInTheDocument();
  });

  it('muestra "Volver" en el paso 2 y retrocede al paso 1', async () => {
    const user = userEvent.setup();
    render(<OnboardingModal {...DEFAULT_PROPS} />);

    await user.click(screen.getByTestId('onboarding-modal-next'));
    expect(screen.getByTestId('onboarding-modal-back')).toBeInTheDocument();

    await user.click(screen.getByTestId('onboarding-modal-back'));
    expect(screen.getByTestId('mock-step-org-name')).toBeInTheDocument();
  });

  it('avanza al Paso 3 desde Paso 2', async () => {
    const user = userEvent.setup();
    render(<OnboardingModal {...DEFAULT_PROPS} />);

    await user.click(screen.getByTestId('onboarding-modal-next'));
    await user.click(screen.getByTestId('onboarding-modal-next'));

    expect(screen.getByTestId('mock-step-slack')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-modal-finish')).toBeInTheDocument();
  });

  it('retrocede del Paso 3 al Paso 2', async () => {
    const user = userEvent.setup();
    render(<OnboardingModal {...DEFAULT_PROPS} />);

    await user.click(screen.getByTestId('onboarding-modal-next'));
    await user.click(screen.getByTestId('onboarding-modal-next'));
    await user.click(screen.getByTestId('onboarding-modal-back'));

    expect(screen.getByTestId('mock-step-jurisdictions')).toBeInTheDocument();
  });

  it('llama saveSettingsAction y completeOnboardingAction al finalizar', async () => {
    const user = userEvent.setup();
    render(<OnboardingModal {...DEFAULT_PROPS} />);

    await user.click(screen.getByTestId('onboarding-modal-next'));
    await user.click(screen.getByTestId('onboarding-modal-next'));
    await user.click(screen.getByTestId('onboarding-modal-finish'));

    await waitFor(() => {
      expect(saveSettingsAction).toHaveBeenCalledWith('org-1', expect.any(Object));
      expect(completeOnboardingAction).toHaveBeenCalledWith('org-1');
      expect(routerRefresh).toHaveBeenCalled();
    });
  });

  it('"Saltar configuración" llama completeOnboardingAction y refresca sin guardar nada', async () => {
    const user = userEvent.setup();
    render(<OnboardingModal {...DEFAULT_PROPS} />);

    await user.click(screen.getByTestId('onboarding-modal-skip-all'));

    await waitFor(() => {
      expect(completeOnboardingAction).toHaveBeenCalledWith('org-1');
      expect(saveSettingsAction).not.toHaveBeenCalled();
      expect(routerRefresh).toHaveBeenCalled();
    });
  });
});
