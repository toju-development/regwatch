/**
 * `<StepOrgName>` — Paso 1 del wizard de onboarding.
 *
 * Componente controlled: recibe `value` y llama `onChange`.
 * Sin botones — la navegación la maneja el wizard padre.
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

export interface StepOrgNameProps {
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
}

export function StepOrgName({
  value,
  onChange,
  disabled = false,
}: StepOrgNameProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-4" data-testid="step-org-name">
      <p className="text-muted-foreground text-sm">
        Este nombre es visible para todos los miembros de tu equipo. Podés cambiarlo en cualquier
        momento desde Ajustes.
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="org-name" className="text-sm font-medium">
          Nombre de la organización
        </label>
        <input
          id="org-name"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ej: Acme Corp"
          maxLength={80}
          disabled={disabled}
          className="border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="step-org-name-input"
        />
      </div>
    </div>
  );
}
