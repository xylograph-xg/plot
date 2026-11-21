import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizationKinds, normalizationTransform } from '../../lib/normalization';
import { datasetView } from '../../lib/rowFilter';
import { resolveChartSeries, supportsTrendline } from '../../lib/xySeries';
import { useStore } from '../../store/useStore';
import type { NormalizationKind } from '../../types';

export function NormalizationTab() {
  const { t } = useTranslation();
  const chart = useStore((state) => state.charts.find((item) => item.id === state.activeChartId));
  const datasets = useStore((state) => state.datasets);
  const views = useMemo(() => chart && supportsTrendline(chart.type)
    ? datasets.filter((dataset) => chart.series.some((mapping) => mapping.datasetId === dataset.id)).map(datasetView)
    : [], [chart, datasets]);
  const displayed = useMemo(() => chart ? resolveChartSeries(chart, views) : [], [chart, views]);

  if (!chart || !supportsTrendline(chart.type)) {
    return <p className="p-3 text-xs text-(--text-2)">{t('normalization.types')}</p>;
  }
  if (!chart.series.length) return <p className="p-3 text-xs text-(--text-2)">{t('fit.empty')}</p>;
  const first = chart.series[0].normalization ?? 'none';
  const uniform = chart.series.every((item) => (item.normalization ?? 'none') === first);
  const options = normalizationKinds.map((kind) => <option key={kind} value={kind}>{t(`normalization.methods.${kind}`)}</option>);

  return (
    <div className="space-y-3 p-3">
      <p className="text-xs text-(--text-2)">{t('normalization.hint')}</p>
      {chart.series.length > 1 && (
        <label className="block text-xs font-semibold">
          <span className="label">{t('normalization.all')}</span>
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
      )}
      {chart.series.map((mapping) => {
        const dataset = views.find(({ id }) => id === mapping.datasetId);
        if (!dataset) return null;
        const label = mapping.name || dataset.columns[mapping.yCol] || dataset.name;
        const kind = mapping.normalization ?? 'none';
        const groups = kind !== 'none' ? displayed.filter((item) => item.mapping.id === mapping.id) : [];
        const invalid = groups.filter(({ points }) => !normalizationTransform(kind, points));
        return (
          <div key={mapping.id} className="space-y-2 rounded-lg border border-(--border) p-2">
            <div>
              <h3 className="truncate text-xs font-semibold" title={label}>{label}</h3>
              <p className="truncate text-[11px] text-(--text-3)" title={dataset.name}>{dataset.name}</p>
            </div>
            <select className="input" value={kind}
              aria-label={t('normalization.methodFor', { name: label })}
              onChange={(event) => useStore.getState().updateSeries(chart.id, mapping.id, {
                normalization: event.target.value as NormalizationKind,
              })}>{options}</select>
            {kind !== 'none' && (!groups.length || invalid.length > 0) && (
              <p role="status" className="text-[11px] text-(--text-2)">
                {t('normalization.unavailable')}
                {mapping.groupCol >= 0 && invalid.length > 0 && ` ${invalid.map((item) => item.name).join(', ')}`}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
