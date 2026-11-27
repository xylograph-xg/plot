import { reportError } from '../../lib/diagnostics';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { fitModels, isFitModel } from '../../lib/fitModels';
import { datasetView } from '../../lib/rowFilter';
import { normalizedSeries } from '../../lib/normalization';
import { useFitResults } from '../chart/useFitResults';
import { hasCategoricalX, isCurveVisible, resolveChartSeries, supportsTrendline } from '../../lib/xySeries';
import { useStore } from '../../store/useStore';
import type { TrendlineResult } from '../../lib/trendline';
import { openFitWindow } from '../../lib/fitWindows';
import { axisBounds } from '../../lib/axisBounds';
import { fitNumber, fitParameterNumber, linearEquation } from '../../lib/fitResultText';
import type { ActiveTrendlineKind, ChartConfig, Dataset } from '../../types';
import { selectedTrendlines, setTrendline, trendlineLabel, trendlineSelection } from '../../lib/trendlineSelection';

import { FitMethodSelect } from './FitMethodSelect';
import { SpectrumPanel } from './SpectrumPanel';

export function FitTab() {
  const { t } = useTranslation();
  const chart = useStore((state) => state.charts.find((item) => item.id === state.activeChartId));
  const datasets = useStore((state) => state.datasets);
  const [openFailed, setOpenFailed] = useState(false);
  return <FitControls chart={chart} datasets={datasets} onModel={(id, kind) => {
    const mapping = chart?.series.find((item) => item.id === id);
    if (chart && mapping) {
      const active = selectedTrendlines(mapping);
      useStore.getState().updateSeries(chart.id, id, trendlineSelection(setTrendline(active, kind, !active.includes(kind))));
    }
  }} toolbar={chart && (
    <>
      {window.fitWindows && <button className="btn w-full" onClick={() => {
        setOpenFailed(false);
        const name = chart.title.trim() || datasets.find((item) => item.id === chart.series[0]?.datasetId)?.name;
        void openFitWindow(chart.id, name ? `${t('fit.windowTitle')} · ${name}` : t('fit.windowTitle'))
          .catch((error) => {
            reportError('Open fit window', error);
            setOpenFailed(true);
          });
      }}>{t('fit.openWindow')}</button>}
      {openFailed && <p role="alert" className="text-xs text-red-500">{t('fit.windowError')}</p>}
      <SpectrumPanel key={chart.id} chart={chart} datasets={datasets} />
    </>
  )} />;
}

export function FitControls({ chart, datasets, onModel, toolbar }: {
  chart: ChartConfig | undefined;
  datasets: Dataset[];
  onModel(id: string, method: ActiveTrendlineKind): void;
  toolbar?: ReactNode;
}) {
  const { t } = useTranslation();
  const resolved = useMemo(() => {
    if (!chart || !supportsTrendline(chart.type)) return [];
    const views = datasets.filter((dataset) => chart.series.some((item) => item.datasetId === dataset.id)).map(datasetView);
    return resolveChartSeries(chart, views).filter(isCurveVisible);
  }, [chart, datasets]);

  const fitResults = useFitResults(chart, resolved);

  if (!chart || !supportsTrendline(chart.type)) {
    return <p className="p-3 text-xs text-(--text-2)">{t('fit.types')}</p>;
  }
  if (!chart.series.length) {
    return <p className="p-3 text-xs text-(--text-2)">{t('fit.empty')}</p>;
  }
  const categoryX = hasCategoricalX(resolved);
  const xBounds = axisBounds(chart.xAxis);
  const range = ({ min, max }: ReturnType<typeof axisBounds>) =>
    `[${min ?? t('style.auto')}, ${max ?? t('style.auto')}]`;
  return (
    <div className="space-y-2 p-3">
      {toolbar}
      {categoryX && <p className="text-xs text-(--text-2)">{t('fit.numericX')}</p>}
      {!categoryX && <p className="text-xs text-(--text-2)">{t('fit.rangeHint')}</p>}
      {chart.series.map((mapping) => {
        const dataset = datasets.find((item) => item.id === mapping.datasetId);
        if (!dataset) return null;
        const label = mapping.name || dataset.columns[mapping.yCol] || dataset.name;
        const groups = resolved.filter((item) => item.mapping.id === mapping.id);
        const methods = selectedTrendlines(mapping);
        const yBounds = axisBounds(mapping.y2 ? chart.y2Axis : chart.yAxis);
        const hasLimits = [xBounds.min, xBounds.max, yBounds.min, yBounds.max].some((bound) => bound !== undefined);
        return (
          <div className="space-y-2 rounded-lg border border-(--border) p-2" key={mapping.id}>
            <div className="min-w-0">
              <h3 className="truncate text-xs font-semibold" title={label}>{label}</h3>
              <p className="truncate text-[11px] text-(--text-3)" title={dataset.name}>{dataset.name}</p>
            </div>
            {!categoryX && hasLimits && <p className="text-[11px] text-(--text-2)">
              X {range(xBounds)} · {mapping.y2 ? 'Y₂' : 'Y'} {range(yBounds)}
            </p>}
            {!categoryX && (xBounds.invalid || yBounds.invalid) && (
              <p className="text-[11px] text-(--text-2)">{t('style.invalidBounds')}</p>
            )}
            <FitMethodSelect label={t('fit.methodFor', { name: label })} active={methods}
              onToggle={(method) => onModel(mapping.id, method)} />
            {!categoryX && methods.map((kind) => (
              <div key={kind} className="space-y-1 text-[11px] text-(--text-2)">
                {methods.length > 1 && <div className="font-medium">{t(trendlineLabel(kind))}</div>}
                {!groups.length && <p>{t('fit.emptyPoints')}</p>}
                {groups.map((group) => {
                  const result: TrendlineResult | undefined = fitResults.trendline(normalizedSeries(group), kind);
                  if (!result) return <p key={group.sid} role="status">{t('fit.calculating')}</p>;
                  const fit = result.fit;
                  const domain = isFitModel(kind) ? fitModels[kind].domain : undefined;
                  return (
                    <div key={group.sid} className="rounded bg-(--bg-subtle) px-2 py-1.5">
                      {mapping.groupCol >= 0 && <div className="font-medium">{group.name}</div>}
                      <div>{t('fit.points', { count: result.count })}</div>
                      {domain && result.excluded > 0 && <div>{t(`fit.domain.${domain}`, { count: result.excluded })}</div>}
                      {fit && (
                        <>
                          {kind === 'linear' ? (
                            <div className="wrap-anywhere font-mono">
                              {linearEquation(fit)}
                            </div>
                          ) : (
                            <>
                              <div className="wrap-anywhere whitespace-pre-line font-mono">{fit.equation}</div>
                              <dl className="grid grid-cols-2 gap-x-2 font-mono">
                                {fit.parameters.map(({ symbol, value }) => (
                                  <div key={symbol} className="wrap-anywhere">
                                    <dt className="inline">{symbol}</dt>
                                    <dd className="inline"> = {fitParameterNumber(symbol, value)}</dd>
                                  </div>
                                ))}
                              </dl>
                            </>
                          )}
                          <div className="font-mono">R² = {fit.r2 == null ? '—' : fitNumber(fit.r2)}</div>
                        </>
                      )}
                      {result.error && (
                        <div>{t(`fit.${result.error}`, { minimum: result.minimum ?? 3 })}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
