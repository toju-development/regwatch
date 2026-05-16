/**
 * `<StepSlack>` — Paso 3 del wizard de onboarding.
 *
 * Componente controlled. Sin botones — la navegación la maneja el wizard.
 * Configurar Slack es opcional.
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

export interface StepSlackProps {
  value: string;
  onChange: (webhookUrl: string) => void;
  disabled?: boolean;
}

const SLACK_WEBHOOK_PREFIX = 'https://hooks.slack.com/services/';

export function StepSlack({
  value,
  onChange,
  disabled = false,
}: StepSlackProps): React.ReactElement {
  const hasValue = value.trim().length > 0;
  const isValid = (() => {
    if (!hasValue) return true;
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && u.hostname === 'hooks.slack.com';
    } catch {
      return false;
    }
  })();

  return (
    <div className="flex flex-col gap-4" data-testid="step-slack">
      <p className="text-muted-foreground text-sm">
        Conectá un canal de Slack para recibir alertas regulatorias en tiempo real. Es opcional —
        podés configurarlo más tarde desde Ajustes.
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="slack-webhook" className="text-sm font-medium">
          URL del webhook de Slack
          <span className="text-muted-foreground ml-1 text-xs font-normal">(opcional)</span>
        </label>
        <input
          id="slack-webhook"
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${SLACK_WEBHOOK_PREFIX}T00000000/B00000000/XXXXXXXX`}
          disabled={disabled}
          className="border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="step-slack-webhook-input"
        />
        {hasValue && !isValid ? (
          <p role="alert" className="text-destructive text-xs" data-testid="step-slack-url-error">
            La URL debe ser un webhook válido de Slack (https://hooks.slack.com/…)
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Para obtener el webhook, andá a tu workspace de Slack → Apps → Incoming Webhooks.
        </p>
      </div>
    </div>
  );
}
