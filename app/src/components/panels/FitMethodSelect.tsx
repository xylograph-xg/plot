import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fitGroups, fitModels } from '../../lib/fitModels';
import { isTrendline, trendlineLabel } from '../../lib/trendlineSelection';
import type { ActiveTrendlineKind, FitModelKind } from '../../types';

const models = Object.keys(fitModels) as FitModelKind[];

export function FitMethodSelect({ label, active, onToggle, favorites = [], disabled = false }: {
  label: string;
  active: ActiveTrendlineKind[];
  onToggle(kind: ActiveTrendlineKind): void;
  favorites?: readonly ActiveTrendlineKind[];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [retained, setRetained] = useState<ActiveTrendlineKind[]>(() => active.filter((kind) => !favorites.includes(kind)));
  const buttons = [...new Set([...favorites, ...retained, ...active])];
  const extraModels = models.filter((model) => !buttons.includes(model));
  const movingAvailable = !buttons.includes('movingAverage');
  const toggle = (kind: ActiveTrendlineKind) => {
    const next = [...new Set([...retained, ...active, kind])].filter((method) => !favorites.includes(method));
    if (next.length !== retained.length) setRetained(next);
    onToggle(kind);
  };
  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      <div className="flex items-start gap-1">
        <div className="flex min-h-7 min-w-0 flex-1 flex-wrap items-center gap-1">
          {!buttons.length && <span className="text-[11px] text-(--text-3)">{t('fit.none')}</span>}
          {buttons.map((kind) => {
            const name = t(trendlineLabel(kind));
            return (
              <button key={kind} type="button" disabled={disabled} aria-pressed={active.includes(kind)}
                aria-label={name} title={name} onClick={() => toggle(kind)}
                className="btn max-w-full !px-1.5 text-(--text-3) aria-pressed:!border-accent aria-pressed:!text-accent disabled:opacity-50">
                {favorites.includes(kind) ? t(`quick.fitShort.${kind}`) : name}
              </button>
            );
          })}
        </div>
        <button type="button" className="btn w-7 shrink-0 !px-0 disabled:opacity-50"
          aria-label={t('quick.moreFits')} aria-expanded={open}
          disabled={disabled || (!extraModels.length && !movingAvailable)} onClick={() => setOpen(!open)}>
          {open ? '−' : '+'}
        </button>
      </div>
      {open && !disabled && (
        <select className="input" aria-label={t('fit.addModel')} value="" onChange={(event) => {
          const kind = event.target.value;
          if (!isTrendline(kind)) return;
          toggle(kind);
          setOpen(false);
        }}>
          <option value="" disabled>{t('fit.addModel')}</option>
          {fitGroups.map((group) => {
            const options = extraModels.filter((model) => fitModels[model].group === group);
            return options.length ? <optgroup key={group} label={t(`fit.groups.${group}`)}>
              {options.map((model) => <option key={model} value={model}>{t(trendlineLabel(model))}</option>)}
            </optgroup> : null;
          })}
          {movingAvailable && <optgroup label={t('fit.groups.smoothing')}>
            <option value="movingAverage">{t(trendlineLabel('movingAverage'))}</option>
          </optgroup>}
        </select>
      )}
    </div>
  );
}
