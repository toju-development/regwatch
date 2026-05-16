/**
 * `<OnboardingModal>` — modal de onboarding sobre el dashboard.
 *
 * Estructura visual:
 *   ┌──────────────────────────────────────┐
 *   │  ●  ○  ○    (stepper centrado)       │
 *   │  Bienvenido a RegWatch  [Saltar conf] │ ← misma fila
 *   │  ─────────────────────────────────── │
 *   │  <contenido del paso>                │
 *   │  ─────────────────────────────────── │
 *   │              [Volver] [Siguiente →]  │
 *   └──────────────────────────────────────┘
 *
 * Responsive:
 *   - Mobile: bottom-sheet (ancho completo, esquinas superiores redondeadas).
 *   - Desktop: dialog centrado, max-w-2xl, max-h 90dvh con scroll interno.
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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

const STEP_SUBTITLES = [
  'Nombre de tu organización',
  'Jurisdicciones a monitorear',
  'Notificaciones en Slack',
] as const;

export interface OnboardingModalProps {
  orgId: string;
  initialOrgName: string;
  initialJurisdictions: JurisdictionDraft[];
  initialChannel: NotificationChannelInitial | null;
}

export function OnboardingModal({
  orgId,
  initialOrgName,
  initialJurisdictions,
  initialChannel,
}: OnboardingModalProps): React.ReactElement {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [orgName, setOrgName] = useState(initialOrgName);
  const [jurisdictions, setJurisdictions] = useState<JurisdictionDraft[]>(initialJurisdictions);
  const [slackWebhook, setSlackWebhook] = useState<string>(initialChannel?.webhookUrl ?? '');

  const [finishing, startFinish] = useTransition();
  const [skipping, startSkip] = useTransition();
  const [finishError, setFinishError] = useState<string | null>(null);

  const isFirst = step === 0;
  const isLast = step === TOTAL_STEPS - 1;
  const isBusy = finishing || skipping;

  function canAdvance(): boolean {
    if (step === 0) return orgName.trim().length > 0;
    if (step === 2 && slackWebhook.trim()) {
      try {
        const u = new URL(slackWebhook);
        return (
          u.protocol === 'https:' &&
          u.hostname === 'hooks.slack.com' &&
          u.pathname.startsWith('/services/')
        );
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
      router.refresh();
    });
  }

  function handleFinish(): void {
    setFinishError(null);
    startFinish(async () => {
      if (orgName.trim() !== initialOrgName.trim()) {
        const r = await renameOrgAction(orgId, orgName.trim());
        if (!r.ok) {
          setFinishError(r.error ?? 'No se pudo guardar el nombre.');
          return;
        }
      }
      const s = await saveSettingsAction(orgId, { jurisdictions });
      if (!s.ok) {
        setFinishError(s.error ?? 'No se pudieron guardar las jurisdicciones.');
        return;
      }
      if (slackWebhook.trim()) await saveSlackChannelAction(orgId, slackWebhook.trim());
      const c = await completeOnboardingAction(orgId);
      if (!c.ok) {
        setFinishError(c.error ?? 'No se pudo completar el onboarding.');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      data-testid="onboarding-modal-overlay"
    >
      <div
        className="bg-background flex w-full flex-col overflow-hidden rounded-t-2xl sm:max-w-2xl sm:rounded-2xl"
        style={{ maxHeight: '95dvh' }}
        role="dialog"
        aria-modal="true"
        aria-label="Configuración inicial"
        data-testid="onboarding-modal"
      >
        {/* Header fijo: título/saltar → stepper → subtítulo */}
        <div className="flex flex-col gap-3 px-6 pt-4 sm:px-8 sm:pt-5">
          {/* Título + Saltar en la misma fila */}
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold">Bienvenido a RegWatch</h1>
            <button
              type="button"
              onClick={handleSkipAll}
              disabled={isBusy}
              className="text-muted-foreground hover:text-foreground shrink-0 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="onboarding-modal-skip-all"
            >
              Saltar configuración
            </button>
          </div>

          {/* Stepper */}
          <div className="flex justify-center gap-2" aria-hidden>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 w-10 rounded-full transition-colors ${
                  i === step ? 'bg-foreground' : 'bg-muted'
                }`}
                data-testid={`onboarding-modal-dot-${i}`}
              />
            ))}
          </div>

          {/* Subtítulo del paso actual */}
          <p className="text-foreground/70 text-sm font-medium">{STEP_SUBTITLES[step]}</p>
        </div>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">
          {step === 0 && <StepOrgName value={orgName} onChange={setOrgName} disabled={isBusy} />}
          {step === 1 && (
            <StepJurisdictions
              value={jurisdictions}
              onChange={setJurisdictions}
              disabled={isBusy}
            />
          )}
          {step === 2 && (
            <StepSlack value={slackWebhook} onChange={setSlackWebhook} disabled={isBusy} />
          )}
        </div>

        {/* Footer fijo: errores + botones */}
        <div className="border-border border-t px-6 py-4 sm:px-8">
          {finishError ? (
            <p
              role="alert"
              className="text-destructive mb-3 text-sm"
              data-testid="onboarding-modal-finish-error"
            >
              {finishError}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            {!isFirst && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep((s) => s - 1)}
                disabled={isBusy}
                data-testid="onboarding-modal-back"
              >
                Volver
              </Button>
            )}
            {isLast ? (
              <Button
                type="button"
                onClick={handleFinish}
                disabled={isBusy || !canAdvance()}
                data-testid="onboarding-modal-finish"
              >
                {finishing ? 'Guardando…' : 'Finalizar'}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                disabled={isBusy || !canAdvance()}
                data-testid="onboarding-modal-next"
              >
                Siguiente
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
