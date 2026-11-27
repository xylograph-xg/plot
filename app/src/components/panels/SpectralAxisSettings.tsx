import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartConfig, Dataset, SpectralAxisDirection } from '../../types';
import { useStore } from '../../store/useStore';
import { spectralAxisPatch, spectralDirections } from '../../lib/spectralAxis';
import { invalidSpectralSources, spectralAxisSources } from '../../lib/xySeries';

export function SpectralAxisSettings({ chart, datasets }: { chart: ChartConfig; datasets: Dataset[] }) {
  const { t } = useTranslation();
  const [chosenDirection, setDirection] = useState<SpectralAxisDirection | ''>();
  const [chosenDensity, setDensity] = useState<boolean>();
  const active = chart.spectralAxis;
  const direction = chosenDirection ?? active?.direction ?? '';
  const preference = chart.spectralAxisPreference ?? active;
  const density = chosenDensity ?? (preference?.direction === direction ? preference.density : false);
  const changed = direction !== (active?.direction ?? '') || (direction && density !== active?.density);
  const { series } = chart;
  const sources = useMemo(() => direction ? spectralAxisSources({ series }, datasets) : [], [direction, series, datasets]);
  const bad = direction ? invalidSpectralSources(sources, direction).map(({ column }) => column || t('chart.rowIndex')) : [];
  const skipped = sources.reduce((count, source) => count + source.skipped, 0);

  return (
    <details className="space-y-1.5">
      <summary className="cursor-pointer text-[11px] text-(--text-2)">{t('spectralAxis.mode')}</summary>
      <label>
        <select className="input" aria-label={t('spectralAxis.mode')} value={direction}
          onChange={(event) => setDirection(event.target.value as SpectralAxisDirection | '')}>
          <option value="">{t('spectralAxis.original')}</option>
          {spectralDirections.map((item) => (
            <option key={item} value={item}>{t(`spectralAxis.directions.${item}`)}</option>
          ))}
        </select>
      </label>
      {direction && (
        <>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={density} onChange={(event) => setDensity(event.target.checked)} />
            {t('spectralAxis.convertDensity')}
          </label>
          <p className="text-[11px] text-(--text-2)">{t(density ? 'spectralAxis.densityHint' : 'spectralAxis.axisOnlyHint')}</p>
        </>
      )}
      {bad.length > 0 && <p role="alert" className="text-[11px] text-red-500">
        {t('spectralAxis.invalid', { names: [...new Set(bad)].join(', ') })}
      </p>}
      {skipped > 0 && !bad.length && <p className="text-[11px] text-(--text-2)">{t('spectralAxis.skipped', { count: skipped })}</p>}
      <button className="btn-primary w-full disabled:opacity-50" disabled={!changed || bad.length > 0}
        onClick={() => {
          useStore.getState().updateChart(chart.id, spectralAxisPatch(chart, direction || undefined, density,
            direction ? t(`spectralAxis.labels.${direction}`) : ''));
          setDirection(undefined);
          setDensity(undefined);
        }}>
        {t('quick.apply')}
      </button>
      {active && <p role="status" className="text-[11px] text-(--text-2)">
        {t(`spectralAxis.directions.${active.direction}`)} · {t(active.density ? 'spectralAxis.convertDensity' : 'spectralAxis.axisOnly')}
      </p>}
    </details>
  );
}
