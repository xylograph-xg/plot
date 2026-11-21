import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartConfig } from '../../types';
import { useStore } from '../../store/useStore';
import { spectralAxisPatch, spectralOutputUnit } from '../../lib/spectralAxis';
import { quickSpectralAxis } from '../../lib/xySeries';

export function SpectralAxisToggle({ chart }: { chart?: ChartConfig }) {
  const { t } = useTranslation();
  const datasets = useStore((state) => state.datasets);
  const selection = useMemo(() => chart && quickSpectralAxis(chart, datasets), [chart, datasets]);
  if (!chart || !selection) return null;

  const converted = Boolean(chart.spectralAxis);
  const output = spectralOutputUnit(selection.direction);
  const input = output === 'eV' ? 'nm' : 'eV';
  const shown = converted ? output : input;
  const next = converted ? input : output;
  return (
    <button type="button" aria-label={t('spectralAxis.quickSwitch')} aria-pressed={converted}
      title={t('spectralAxis.switchTo', { unit: next })}
      className="btn flex shrink-0 items-center gap-1.5 whitespace-nowrap !py-1 text-[11px] aria-pressed:!border-accent"
      onClick={() => {
        const direction = converted ? undefined : selection.direction;
        useStore.getState().updateChart(chart.id, spectralAxisPatch(chart, direction, selection.density,
          direction ? t(`spectralAxis.labels.${direction}`) : ''));
      }}>
      <span className={shown === 'nm' ? 'font-semibold text-accent' : 'text-(--text-3)'}>nm</span>
      <span aria-hidden="true">↔</span>
      <span className={shown === 'eV' ? 'font-semibold text-accent' : 'text-(--text-3)'}>eV</span>
    </button>
  );
}
