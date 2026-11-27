import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizationKinds, normalizedSeries } from '../../lib/normalization';
import { datasetView } from '../../lib/rowFilter';
import { resolveChartSeries } from '../../lib/xySeries';
import { useStore } from '../../store/useStore';
import type { ChartConfig, Dataset, NormalizationKind, SeriesMapping } from '../../types';

export function NormalizationControls({ chart, datasets }: { chart: ChartConfig; datasets: Dataset[] }) {
  const { t } = useTranslation();
  const views = useMemo(() => datasets.filter((dataset) => chart.series.some((mapping) => mapping.datasetId === dataset.id))
    .map(datasetView), [chart.series, datasets]);
  const resolved = useMemo(() => resolveChartSeries(chart, views), [chart, views]);
  const first = chart.series[0].normalization ?? 'none';
  const uniform = chart.series.every((item) => (item.normalization ?? 'none') === first);
  const options = normalizationKinds.map((kind) => <option key={kind} value={kind}>{t(`normalization.methods.${kind}`)}</option>);
  const unavailable = (mapping: SeriesMapping) => {
    const kind = mapping.normalization ?? 'none';
    if (kind === 'none') return null;
    const groups = resolved.filter((item) => item.mapping.id === mapping.id);
    const invalid = groups.filter((group) => !normalizedSeries(group).points.length);
    if (groups.length && !invalid.length) return null;
    return <p role="status" className="text-[11px] text-(--text-2)">
      {t('normalization.unavailable')}
      {mapping.groupCol >= 0 && invalid.length > 0 && ` ${invalid.map((item) => item.name).join(', ')}`}
    </p>;
  };

  return (
    <div className="space-y-1.5">
      <label className="block" title={t('normalization.hint')}>
        <span className="label">{t('normalization.title')}</span>
        <select className="input" value={uniform ? first : 'mixed'} onChange={(event) => {
          const normalization = event.target.value as NormalizationKind;
          useStore.getState().updateChart(chart.id, {
            series: chart.series.map((item) => ({ ...item, normalization })),
          });
        }}>
          {!uniform && <option value="mixed" disabled>{t('normalization.mixed')}</option>}
          {options}
        </select>
      </label>
      {chart.series.length === 1 ? unavailable(chart.series[0]) : (
        <details className="space-y-1.5">
          <summary className="cursor-pointer text-[11px] text-(--text-2)">{t('normalization.mixed')}</summary>
          {chart.series.map((mapping) => {
            const dataset = views.find(({ id }) => id === mapping.datasetId);
            if (!dataset) return null;
            const name = mapping.name || dataset.columns[mapping.yCol] || dataset.name;
            return (
              <label key={mapping.id} className="block space-y-1">
                <span className="label truncate" title={dataset.name}>{name}</span>
                <select className="input" value={mapping.normalization ?? 'none'}
                  aria-label={t('normalization.methodFor', { name })}
                  onChange={(event) => useStore.getState().updateSeries(chart.id, mapping.id, {
                    normalization: event.target.value as NormalizationKind,
                  })}>{options}</select>
                {unavailable(mapping)}
              </label>
            );
          })}
        </details>
      )}
    </div>
  );
}
