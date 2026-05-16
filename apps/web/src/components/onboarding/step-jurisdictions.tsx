/**
 * `<StepJurisdictions>` — Paso 2 del wizard de onboarding.
 *
 * Componente controlled. Sin botones — la navegación la maneja el modal.
 *
 * UI:
 *   - Grilla compacta de toggle buttons con bandera SVG + nombre del país.
 *   - Al seleccionar países, aparece un área de tópicos abajo (altura fija).
 *   - El modal NO crece por la selección — los tópicos se muestran en el
 *     área scrolleable del modal.
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

import { JURISDICTIONS, type JurisdictionCode } from '@regwatch/types';

// Banderas SVG de country-flag-icons (3:2 aspect ratio).
// Importamos solo los países que usamos para no cargar el bundle completo.
import MX from 'country-flag-icons/react/3x2/MX';
import CO from 'country-flag-icons/react/3x2/CO';
import PE from 'country-flag-icons/react/3x2/PE';
import CL from 'country-flag-icons/react/3x2/CL';
import AR from 'country-flag-icons/react/3x2/AR';
import UY from 'country-flag-icons/react/3x2/UY';
import BR from 'country-flag-icons/react/3x2/BR';
import EC from 'country-flag-icons/react/3x2/EC';
import PA from 'country-flag-icons/react/3x2/PA';

const FLAG_COMPONENTS: Record<
  string,
  React.ComponentType<{ className?: string; title?: string }>
> = {
  MX,
  CO,
  PE,
  CL,
  AR,
  UY,
  BR,
  EC,
  PA,
};

export interface JurisdictionDraft {
  code: string;
  enabled: boolean;
  customTopics: string;
}

export interface StepJurisdictionsProps {
  value: JurisdictionDraft[];
  onChange: (next: JurisdictionDraft[]) => void;
  disabled?: boolean;
}

function buildMap(drafts: JurisdictionDraft[]): Map<string, JurisdictionDraft> {
  const m = new Map<string, JurisdictionDraft>();
  for (const d of drafts) m.set(d.code, d);
  return m;
}

export function StepJurisdictions({
  value,
  onChange,
  disabled = false,
}: StepJurisdictionsProps): React.ReactElement {
  const map = buildMap(value);

  function getRow(code: string): JurisdictionDraft {
    return map.get(code) ?? { code, enabled: false, customTopics: '' };
  }

  function toggleJurisdiction(code: JurisdictionCode): void {
    const next = JURISDICTIONS.map((j) => {
      const current = getRow(j.code);
      if (j.code === code) return { ...current, enabled: !current.enabled };
      return current;
    });
    onChange(next);
  }

  function setTopics(code: JurisdictionCode, customTopics: string): void {
    const next = JURISDICTIONS.map((j) => {
      const current = getRow(j.code);
      if (j.code === code) return { ...current, customTopics };
      return current;
    });
    onChange(next);
  }

  const selected = JURISDICTIONS.filter((j) => getRow(j.code).enabled);

  return (
    <div className="flex flex-col gap-4" data-testid="step-jurisdictions">
      <p className="text-muted-foreground text-sm">
        Seleccioná los países cuyas regulaciones RegWatch debe monitorear. Podés cambiar esto
        después desde Ajustes.
      </p>

      {/* Grilla compacta de toggle buttons */}
      <div className="flex flex-wrap gap-2" data-testid="step-jurisdictions-list">
        {JURISDICTIONS.map((j) => {
          const row = getRow(j.code);
          const Flag = FLAG_COMPONENTS[j.code];
          return (
            <button
              key={j.code}
              type="button"
              onClick={() => toggleJurisdiction(j.code)}
              disabled={disabled}
              data-testid={`step-jurisdictions-${j.code}-toggle`}
              aria-pressed={row.enabled}
              className={[
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
                'focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
                row.enabled
                  ? 'bg-foreground text-background border-foreground font-medium'
                  : 'bg-background text-foreground border-input hover:bg-muted',
              ].join(' ')}
            >
              {Flag ? <Flag className="h-3 w-4 shrink-0 rounded-sm" title={j.name} /> : null}
              <span className="truncate">{j.name}</span>
            </button>
          );
        })}
      </div>

      {/* Área de tópicos — solo para países seleccionados */}
      {selected.length > 0 ? (
        <div
          className="border-border flex flex-col gap-3 border-t pt-4"
          data-testid="step-jurisdictions-topics"
        >
          <p className="text-muted-foreground text-xs">
            Tópicos por país — opcional. Dejalo vacío para monitorear todo.
          </p>
          {selected.map((j) => {
            const row = getRow(j.code);
            return (
              <div key={j.code} className="flex flex-col gap-1">
                <label htmlFor={`topics-${j.code}`} className="text-xs font-medium">
                  {j.name}
                </label>
                <input
                  id={`topics-${j.code}`}
                  type="text"
                  value={row.customTopics}
                  disabled={disabled}
                  onChange={(e) => setTopics(j.code, e.target.value)}
                  placeholder="Ej: fintech, datos personales"
                  className="border-input bg-background focus-visible:ring-ring flex h-8 w-full rounded-md border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid={`step-jurisdictions-${j.code}-topics`}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
