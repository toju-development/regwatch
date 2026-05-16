/**
 * `<OnboardingWizard>` — stepper de 3 pasos para el flujo de onboarding.
 *
 * Layout:
 *   1. Stepper (dots) — centrado en la parte superior.
 *   2. Fila: título del paso (izquierda) + "Saltar configuración" (derecha).
 *   3. Contenido del paso activo.
 *   4. Fila de botones — alineada a la derecha.
 *
 * Flujo de guardado:
 *   - "Siguiente" avanza sin guardar — lleva los cambios al estado local.
 *   - "Volver" retrocede sin perder lo ingresado.
 *   - "Saltar configuración" llama completeOnboardingAction y onDone.
 *   - "Finalizar" (último paso) guarda todo en secuencia y llama onDone.
 *
 * Responsive: los botones se apilan en mobile, van en fila en desktop.
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';

import {
  completeOnboardingAction,
  renameOrgAction,
  saveSettingsAction,
  saveSlackChannelAction,
} from './actions';
import { StepOrgName } from './step-org-name';
import { StepJurisdictions } from './step-jurisdictions';
import { StepSlack } from './step-slack';

import type { JurisdictionDraft } from './step-jurisdictions';
import type { NotificationChannelInitial } from '@/components/settings/notification-channel-form';

const TOTAL_STEPS = 3;

const STEP_TITLES = [
  'Nombrá tu organización',
  'Seleccioná las jurisdicciones',
  'Configurá notificaciones',
];

export interface OnboardingWizardProps {
  orgId: string;
  initialOrgName: string;
  initialJurisdictions: JurisdictionDraft[];
  initialChannel: NotificationChannelInitial | null;
  onDone: () => void;
}

export function OnboardingWizard({
  orgId,
  initialOrgName,
  initialJurisdictions,
  initialChannel,
  onDone,
}: OnboardingWizardProps): React.ReactElement {
  const [step, setStep] = useState(0);

  // Estado acumulado — se guarda todo junto al finalizar.
  const [orgName, setOrgName] = useState(initialOrgName);
  const [jurisdictions, setJurisdictions] = useState<JurisdictionDraft[]>(initialJurisdictions);
  const [slackWebhook, setSlackWebhook] = useState<string>(initialChannel?.webhookUrl ?? '');

  const [finishing, startFinish] = useTransition();
  const [skipping, startSkip] = useTransition();
  const [finishError, setFinishError] = useState<string | null>(null);

  const isFirst = step === 0;
  const isLast = step === TOTAL_STEPS - 1;
  const isBusy = finishing || skipping;

  function goNext(): void {
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  function goBack(): void {
    setStep((s) => Math.max(s - 1, 0));
  }

  // Valida si se puede avanzar desde el paso actual.
  function canAdvance(): boolean {
    if (step === 0) return orgName.trim().length > 0;
    if (step === 2) {
      // Slack es opcional; si tiene valor debe ser URL de Slack válida.
      if (!slackWebhook.trim()) return true;
      try {
        const u = new URL(slackWebhook);
        return u.protocol === 'https:' && u.hostname === 'hooks.slack.com';
      } catch {
        return false;
      }
    }
    return true;
  }

  function handleSkipAll(): void {
    setFinishError(null);
    startSkip(async () => {
      const result = await completeOnboardingAction(orgId);
      if (!result.ok) {
        setFinishError(result.error ?? 'No se pudo completar el onboarding. Intentá de nuevo.');
        return;
      }
      onDone();
    });
  }

  function handleFinish(): void {
    setFinishError(null);
    startFinish(async () => {
      // 1. Renombrar org si cambió.
      if (orgName.trim() !== initialOrgName.trim()) {
        const r = await renameOrgAction(orgId, orgName.trim());
        if (!r.ok) {
          setFinishError(r.error ?? 'No se pudo guardar el nombre. Intentá de nuevo.');
          return;
        }
      }

      // 2. Guardar jurisdicciones.
      const s = await saveSettingsAction(orgId, { jurisdictions });
      if (!s.ok) {
        setFinishError(s.error ?? 'No se pudieron guardar las jurisdicciones. Intentá de nuevo.');
        return;
      }

      // 3. Guardar Slack si se ingresó webhook (no bloqueante).
      if (slackWebhook.trim()) {
        await saveSlackChannelAction(orgId, slackWebhook.trim());
      }

      // 4. Marcar onboarding completo.
      const c = await completeOnboardingAction(orgId);
      if (!c.ok) {
        setFinishError(c.error ?? 'No se pudo completar el onboarding. Intentá de nuevo.');
        return;
      }

      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-6 pt-4" data-testid="onboarding-wizard">
      {/* 1. Stepper centrado */}
      <div className="flex justify-center gap-2" aria-hidden>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 w-10 rounded-full transition-colors ${
              i === step ? 'bg-foreground' : 'bg-muted'
            }`}
            data-testid={`onboarding-wizard-dot-${i}`}
          />
        ))}
      </div>

      {/* 2. Título del paso + Saltar (misma fila) */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold" data-testid="onboarding-wizard-step-indicator">
            {STEP_TITLES[step]}
          </h2>
        </div>
        <button
          type="button"
          onClick={handleSkipAll}
          disabled={isBusy}
          className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="onboarding-wizard-skip-all"
        >
          Saltar configuración
        </button>
      </div>

      {/* 3. Contenido del paso */}
      <div>
        {step === 0 && <StepOrgName value={orgName} onChange={setOrgName} disabled={isBusy} />}
        {step === 1 && (
          <StepJurisdictions value={jurisdictions} onChange={setJurisdictions} disabled={isBusy} />
        )}
        {step === 2 && (
          <StepSlack value={slackWebhook} onChange={setSlackWebhook} disabled={isBusy} />
        )}
      </div>

      {/* 4. Botones de navegación — alineados a la derecha */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
        {!isFirst && (
          <Button
            type="button"
            variant="outline"
            onClick={goBack}
            disabled={isBusy}
            data-testid="onboarding-wizard-back"
          >
            Volver
          </Button>
        )}
        {isLast ? (
          <Button
            type="button"
            onClick={handleFinish}
            disabled={isBusy || !canAdvance()}
            data-testid="onboarding-wizard-finish"
          >
            {finishing ? 'Guardando…' : 'Finalizar'}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={goNext}
            disabled={isBusy || !canAdvance()}
            data-testid="onboarding-wizard-next"
          >
            Siguiente
          </Button>
        )}
      </div>

      {isBusy ? (
        <p
          className="text-muted-foreground text-right text-sm"
          data-testid="onboarding-wizard-finishing"
        >
          {skipping ? 'Saltando…' : 'Finalizando configuración…'}
        </p>
      ) : null}
      {finishError ? (
        <p
          role="alert"
          className="text-destructive text-sm"
          data-testid="onboarding-wizard-finish-error"
        >
          {finishError}
        </p>
      ) : null}
    </div>
  );
}
