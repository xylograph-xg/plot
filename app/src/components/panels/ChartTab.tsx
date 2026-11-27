import { FitMethodSelect } from './FitMethodSelect';
import { QuickAxis } from './AxisBoundsFields';
import { panelLabel } from '../../lib/chartSources';
import { SeriesEditor } from './SeriesEditor';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultSeries, useStore } from '../../store/useStore';
import type { ActiveTrendlineKind, AutoStartMode, ChartType, RowFilter } from '../../types';
import { DefaultTemplate } from './DefaultTemplate';
import { chartPreset, presetIds, type PresetId } from '../../lib/chartPresets';
import { supportsTrendline } from '../../lib/xySeries';
import { spectralColumnUnit } from '../../lib/spectralAxis';
import { defaultPlateauPoints, minPlateauPoints, maxPlateauPoints, scanRowFilter, validPlateauPoints } from '../../lib/autoStart';
import { AutoStartSelect } from '../data/AutoStartSelect';
import { SpectrumPanel } from './SpectrumPanel';
import { NormalizationControls } from './NormalizationControls';
import { SpectralAxisSettings } from './SpectralAxisSettings';
import { CurveVisibility } from './CurveVisibility';
import { selectedTrendlines, setTrendline, trendlineSelection } from '../../lib/trendlineSelection';

const quickTypes = ['scatter', 'line', 'bar'] as const;
const quickFits = ['linear', 'exponentialDecay', 'doubleExponentialDecay'] as const;
const quickButton = 'btn min-w-0 flex-1 !px-1 whitespace-nowrap aria-pressed:!border-accent aria-pressed:!text-accent disabled:opacity-50';

const CHART_TYPES: { type: ChartType; icon: string }[] = [
  { type: 'line', icon: 'M3 17l5-6 4 3 6-8' },
  { type: 'scatter', icon: 'M5 16a1.4 1.4 0 100-2.8A1.4 1.4 0 005 16zm6-5a1.4 1.4 0 100-2.8 1.4 1.4 0 000 2.8zm5 7a1.4 1.4 0 100-2.8 1.4 1.4 0 000 2.8zm2-11a1.4 1.4 0 100-2.8 1.4 1.4 0 000 2.8z' },
  { type: 'bar', icon: 'M4 19V11h3v8zm6.5 0V5h3v14zm6.5 0v-6h3v6z' },
  { type: 'barh', icon: 'M5 4h8v3H5zm0 6.5h14v3H5zm0 6.5h6v3H5z' },
  { type: 'area', icon: 'M3 18l5-7 4 3 6-8v12H3z' },
  { type: 'pie', icon: 'M12 3a9 9 0 11-9 9h9z M14 3a9 9 0 017 7h-7z' },
  { type: 'box', icon: 'M8 4v3M8 17v3M5 7h6v10H5zM8 12h0M16 7v2M16 15v3M13 9h6v6h-6z' },
  { type: 'violin', icon: 'M12 3c1 3 4 4 4 8s-3 5-4 9c-1-4-4-5-4-9s3-5 4-8z' },
  { type: 'histogram', icon: 'M3 19v-4h4v4zm4.7 0V9h4v10zm4.6 0v-7h4v7zm4.7 0V12h4v7z' },
  { type: 'density', icon: 'M3 18c3 0 3-9 6-9s3 6 6 6 3-4 6-4' },
  { type: 'heatmap', icon: 'M4 4h5v5H4zM10 4h5v5h-5zM16 4h4v5h-4zM4 10h5v5H4zM10 10h5v5h-5zM16 10h4v5h-4z' },
  { type: 'correlation', icon: 'M4 4h4v4H4zM10 10h4v4h-4zM16 16h4v4h-4zM16 4h4v4h-4zM4 16h4v4H4z' },
  { type: 'radar', icon: 'M12 3l8 6-3 9H7L4 9zM12 7l4 3-1.5 5h-5L8 10z' },
  { type: 'polar', icon: 'M12 12m-8 0a8 8 0 1016 0 8 8 0 10-16 0M12 12m-4 0a4 4 0 108 0 4 4 0 10-8 0M12 4v16' },
];

export function ChartTab() {
  const { t } = useTranslation();
  const datasets = useStore((s) => s.datasets);
  const charts = useStore((s) => s.charts);
  const chart = useStore((s) => s.charts.find((c) => c.id === s.activeChartId));
  const layout = useStore((s) => s.layout);
  const setChartType = useStore((s) => s.setChartType);
  const updateChart = useStore((s) => s.updateChart);
  const addSeries = useStore((s) => s.addSeries);
  const addChart = useStore((s) => s.addChart);
  const duplicateChart = useStore((s) => s.duplicateChart);
  const removeChart = useStore((s) => s.removeChart);
  const setLayout = useStore((s) => s.setLayout);
  const setActiveChart = useStore((s) => s.setActiveChart);

  const activeDatasetId = useStore((s) => s.activeDatasetId);
  const template = useStore((s) => s.defaultTemplate);
  const [preset, setPreset] = useState<PresetId | ''>('');
  const [presetScan, setPresetScan] = useState<AutoStartMode | ''>('');
  const [presetPoints, setPresetPoints] = useState<string>();
  const [presetStatus, setPresetStatus] = useState<{ chartId: string; message: string }>();
  const [moreCharts, setMoreCharts] = useState(false);

  if (!chart) return null;
  const fitEnabled = supportsTrendline(chart.type) && chart.series.length > 0;
  const xUnit = spectralColumnUnit(chart.xAxis.label);
  const spectrumFirst = xUnit === 'nm' || xUnit === 'eV';
  const spectrumPanel = fitEnabled && <SpectrumPanel key={chart.id} chart={chart} datasets={datasets} />;
  const activeFits = [...new Set(chart.series.flatMap(selectedTrendlines))];
  const toggleFit = (kind: ActiveTrendlineKind) => updateChart(chart.id, {
    series: chart.series.map((item) => ({
      ...item, ...trendlineSelection(setTrendline(selectedTrendlines(item), kind, !activeFits.includes(kind))),
    })),
  });
  const plateauPoints = presetPoints ?? String(template?.plateauPoints ?? defaultPlateauPoints);
  const validScan = !presetScan || validPlateauPoints(Number(plateauPoints));
  const applyPreset = () => {
    if (!preset || !validScan) return;
    const sources = new Set(chart.series.map(({ datasetId }) => datasetId));
    if (sources.size === 0 && activeDatasetId) sources.add(activeDatasetId);
    const selected = datasets.filter(({ id }) => sources.has(id));
    const patch = chartPreset(preset, chart, selected, defaultSeries);
    if (typeof patch === 'string') {
      setPresetStatus({ chartId: chart.id, message: t(`quick.errors.${patch === 'columns' ? preset : patch}`) });
      return;
    }
    const filters = new Map<string, RowFilter>();
    if (presetScan) {
      for (const dataset of selected) {
        const column = (patch.series ?? chart.series).find(({ datasetId }) => datasetId === dataset.id)?.yCol;
        if (column === undefined) continue;
        const filter = scanRowFilter(dataset, { column, mode: presetScan, plateauPoints: Number(plateauPoints) });
        if (typeof filter !== 'string') filters.set(dataset.id, filter);
      }
    }
    updateChart(chart.id, patch, filters);
    const applied = t('quick.applied', { name: t(`quick.presets.${preset}`) });
    const scanned = presetScan ? t('quick.scanResult', { found: filters.size, total: selected.length }) : '';
    setPresetStatus({ chartId: chart.id, message: [applied, scanned].filter(Boolean).join(' · ') });
  };

  return (
    <div className="space-y-1 pb-4">
      {spectrumFirst && spectrumPanel}
      <div className="section-title">{t('quick.title')}</div>
      <div className="mx-3 space-y-2.5 rounded-lg border border-(--border) p-2.5">
        <div>
          <label className="label" htmlFor="chart-preset">{t('quick.preset')}</label>
          <div className="flex gap-1.5">
            <select id="chart-preset" className="input min-w-0" value={preset} onChange={(event) => {
              setPreset(event.target.value as PresetId | '');
              setPresetStatus(undefined);
            }}>
              <option value="">{t('quick.choosePreset')}</option>
              {presetIds.map((id) => <option key={id} value={id}>{t(`quick.presets.${id}`)}</option>)}
            </select>
            <button className="btn shrink-0 disabled:opacity-50" disabled={!preset || !validScan} onClick={applyPreset}>{t('quick.apply')}</button>
          </div>
          {preset && (
            <div className="mt-1.5">
              <span className="label">{t('template.presetScan')}</span>
              <div className="flex gap-1.5">
                <AutoStartSelect value={presetScan} onChange={setPresetScan} allowNone />
                {presetScan && <input className="input !w-14" type="number" min={minPlateauPoints} max={maxPlateauPoints}
                  aria-label={t('autoStart.plateauPoints')} title={t('autoStart.plateauPoints')}
                  value={plateauPoints} onChange={(event) => setPresetPoints(event.target.value)} />}
              </div>
              {!validScan && <p role="alert" className="mt-1 text-[11px] text-red-500">{t('autoStart.invalidPoints', { min: minPlateauPoints, max: maxPlateauPoints })}</p>}
            </div>
          )}
          {presetStatus?.chartId === chart.id && <p role="status" className="mt-1 text-[11px] text-(--text-2)">{presetStatus.message}</p>}
        </div>

        <div>
          <span className="label">{t('chart.type')}</span>
          <div className="flex gap-1">
            {quickTypes.map((type) => (
              <button key={type} className={quickButton} aria-pressed={chart.type === type}
                onClick={() => setChartType(chart.id, type)}>{t(`chart.types.${type}`)}</button>
            ))}
            <button className="btn w-7 shrink-0 !px-0" aria-label={t('quick.moreCharts')} aria-expanded={moreCharts}
              onClick={() => setMoreCharts(!moreCharts)}>{moreCharts ? '−' : '+'}</button>
          </div>
        </div>
        {!quickTypes.some((type) => type === chart.type) && <p className="text-[11px] text-(--text-2)">{t('quick.current', { name: t(`chart.types.${chart.type}`) })}</p>}
        {moreCharts && (
          <div className="grid grid-cols-4 gap-1.5">
            {CHART_TYPES.filter(({ type }) => !quickTypes.some((common) => common === type)).map(({ type, icon }) => (
              <button
                key={type}
                title={t(`chart.types.${type}`)}
                className="flex flex-col items-center gap-1 rounded-lg py-2 cursor-pointer transition-colors border"
                style={{
                  borderColor: chart.type === type ? 'var(--color-accent)' : 'var(--border)',
                  background:
                    chart.type === type
                      ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
                      : 'transparent',
                  color: chart.type === type ? 'var(--color-accent)' : 'var(--text-2)',
                }}
                onClick={() => { setChartType(chart.id, type); setMoreCharts(false); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d={icon} />
                </svg>
                <span className="text-[9.5px] leading-none">{t(`chart.types.${type}`)}</span>
              </button>
            ))}
          </div>
        )}

        <div>
          <span className="label">{t(chart.series.length > 1 ? 'quick.fitAll' : 'fit.title')}</span>
          <FitMethodSelect key={chart.id} label={t('fit.title')} active={activeFits} onToggle={toggleFit}
            favorites={quickFits} disabled={!fitEnabled} />
        </div>

        {(fitEnabled || chart.type === 'bar' || chart.type === 'barh') &&
          <CurveVisibility chart={chart} datasets={datasets} />}

        {fitEnabled && <NormalizationControls chart={chart} datasets={datasets} />}

        <div className="space-y-1.5 border-t border-(--border) pt-2">
          <QuickAxis label={t('style.xAxis')} axis={chart.xAxis}
            onChange={(patch) => updateChart(chart.id, { xAxis: { ...chart.xAxis, ...patch } })} />
          <QuickAxis label={t('style.yAxis')} axis={chart.yAxis}
            onChange={(patch) => updateChart(chart.id, { yAxis: { ...chart.yAxis, ...patch } })} />
          {chart.series.some((item) => item.y2) && <QuickAxis label={t('style.y2Axis')} axis={chart.y2Axis}
            onChange={(patch) => updateChart(chart.id, { y2Axis: { ...chart.y2Axis, ...patch } })} />}
          {fitEnabled && <SpectralAxisSettings key={chart.id} chart={chart} datasets={datasets} />}
        </div>
      </div>

      {!spectrumFirst && spectrumPanel}

      <div className="section-title">{t('chart.title')}</div>
      <div className="px-3 space-y-2">
        <input
          className="input"
          placeholder={t('chart.title')}
          value={chart.title}
          onChange={(e) => updateChart(chart.id, { title: e.target.value })}
        />
        <input
          className="input"
          placeholder={t('chart.subtitle')}
          value={chart.subtitle}
          onChange={(e) => updateChart(chart.id, { subtitle: e.target.value })}
        />
      </div>

      <div className="section-title">{t('chart.series')}</div>
      <div className="px-3 space-y-2">
        {datasets.length === 0 ? (
          <div className="text-[11px] py-2" style={{ color: 'var(--text-3)' }}>
            {t('chart.needData')}
          </div>
        ) : (
          <>
            {chart.series.length === 0 && (
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {t('chart.noSeries')}
              </div>
            )}
            {chart.series.map((m) => (
              <SeriesEditor key={m.id} chartId={chart.id} mapping={m} />
            ))}
            <button className="btn w-full" onClick={() => addSeries(chart.id)}>
              + {t('chart.addSeries')}
            </button>
          </>
        )}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium">{t('quick.layoutAndDefaults')}</summary>
        <div className="section-title">{t('chart.panels')}</div>
        <div className="px-3 flex flex-wrap gap-1.5 items-center">
          {charts.map((c, i) => (
            <button
              key={c.id}
              className="btn !px-2.5"
              style={
                c.id === chart.id
                  ? { background: 'var(--color-accent)', color: '#fff', borderColor: 'transparent' }
                  : undefined
              }
              onClick={() => setActiveChart(c.id)}
            >
              {panelLabel(i)}
            </button>
          ))}
          <button className="btn" onClick={addChart}>
            + {t('chart.addPanel')}
          </button>
          <button className="btn" title={t('chart.duplicatePanel')} onClick={() => duplicateChart(chart.id)}>
            ⧉
          </button>
          {charts.length > 1 && (
            <button className="btn !text-red-500" onClick={() => removeChart(chart.id)}>
              {t('chart.delPanel')}
            </button>
          )}
        </div>
        {charts.length > 1 && (
          <label className="flex items-center gap-1.5 px-3 pt-1 text-[11px]" style={{ color: 'var(--text-2)' }}>
            <input
              type="checkbox"
              checked={layout.showPanelLabels}
              onChange={(e) => setLayout({ showPanelLabels: e.target.checked })}
            />
            {t('chart.panelLabels')}
          </label>
        )}

        <DefaultTemplate chartId={chart.id} />
      </details>
    </div>
  );
}
