import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPalette } from '../../lib/palettes';
import { rebindSeries } from '../../lib/seriesDataset';
import { useStore } from '../../store/useStore';
import type { SeriesMapping } from '../../types';

function ColSelect({
  value,
  columns,
  onChange,
  allowNone,
  noneLabel,
}: {
  value: number;
  columns: string[];
  onChange: (v: number) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {allowNone && <option value={-1}>{noneLabel ?? '—'}</option>}
      {columns.map((c, i) => (
        <option key={i} value={i}>
          {c}
        </option>
      ))}
    </select>
  );
}

export function SeriesEditor({ chartId, mapping }: { chartId: string; mapping: SeriesMapping }) {
  const { t } = useTranslation();
  const datasets = useStore((s) => s.datasets);
  const updateSeries = useStore((s) => s.updateSeries);
  const removeSeries = useStore((s) => s.removeSeries);
  const duplicateSeries = useStore((s) => s.duplicateSeries);
  const chart = useStore((s) => s.charts.find((c) => c.id === chartId));
  const [showStyle, setShowStyle] = useState(false);
  const ds = datasets.find((d) => d.id === mapping.datasetId);
  if (!ds || !chart) return null;

  const isDistribution = ['box', 'violin', 'histogram', 'density'].includes(chart.type);
  const isMatrix = ['heatmap', 'correlation', 'radar'].includes(chart.type);
  const isPie = chart.type === 'pie';
  const isScatter = chart.type === 'scatter';
  const isXY = ['line', 'scatter', 'area', 'polar'].includes(chart.type);
  const patch = (p: Partial<SeriesMapping>) => updateSeries(chartId, mapping.id, p);

  return (
    <div className="rounded-lg p-2 space-y-2" style={{ background: 'var(--bg-subtle)' }}>
      <div className="flex items-center gap-1.5">
        <select
          className="input flex-1"
          aria-label={t('chart.dataset')}
          value={mapping.datasetId}
          onChange={(event) => {
            const next = datasets.find((dataset) => dataset.id === event.target.value);
            if (next) patch(rebindSeries(mapping, ds, next));
          }}
        >
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          className="text-[11px] px-1 shrink-0"
          style={{ color: 'var(--text-3)' }}
          title={t('chart.duplicateSeries')}
          onClick={() => duplicateSeries(chartId, mapping.id)}
        >
          ⧉
        </button>
        <button
          className="text-[11px] px-1 hover:text-red-500 shrink-0"
          style={{ color: 'var(--text-3)' }}
          onClick={() => removeSeries(chartId, mapping.id)}
        >
          ✕
        </button>
      </div>

      {!isMatrix && (
        <div className="grid grid-cols-2 gap-2">
          {!isDistribution && (
            <div>
              <span className="label">{isPie ? t('chart.labelCol') : t('chart.xCol')}</span>
              <ColSelect value={mapping.xCol} columns={ds.columns} onChange={(v) => patch({ xCol: v })}
                allowNone={isXY || isPie} noneLabel={t('chart.rowIndex')} />
            </div>
          )}
          <div>
            <span className="label">{isDistribution || isPie ? t('chart.valueCol') : t('chart.yCol')}</span>
            <ColSelect value={mapping.yCol} columns={ds.columns} onChange={(v) => patch({ yCol: v })} />
          </div>
          {!isDistribution && !isPie && (
            <div>
              <span className="label">{t('chart.errCol')}</span>
              <ColSelect
                value={mapping.errCol}
                columns={ds.columns}
                onChange={(v) => patch({ errCol: v })}
                allowNone
                noneLabel={t('chart.none')}
              />
            </div>
          )}
          {isScatter && (
            <div>
              <span className="label">{t('chart.sizeCol')}</span>
              <ColSelect
                value={mapping.sizeCol}
                columns={ds.columns}
                onChange={(v) => patch({ sizeCol: v })}
                allowNone
                noneLabel={t('chart.none')}
              />
            </div>
          )}
          <div>
            <span className="label">{t('chart.groupCol')}</span>
            <ColSelect
              value={mapping.groupCol}
              columns={ds.columns}
              onChange={(v) => patch({ groupCol: v })}
              allowNone
              noneLabel={t('chart.none')}
            />
          </div>
        </div>
      )}

      {!isMatrix && !isDistribution && !isPie && (
        <>
          <div>
            <span className="label">{t('chart.seriesName')}</span>
            <input
              className="input"
              value={mapping.name}
              placeholder={ds.columns[mapping.yCol]}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
            <input type="checkbox" checked={mapping.y2} onChange={(e) => patch({ y2: e.target.checked })} />
            {t('chart.secondY')}
          </label>

          {/* per-series style */}
          <button
            className="w-full text-left text-[11px] font-medium py-0.5"
            style={{ color: 'var(--color-accent)' }}
            onClick={() => setShowStyle(!showStyle)}
          >
            {showStyle ? '▾' : '▸'} {t('chart.seriesStyle')}
          </button>
          {showStyle && (
            <div className="space-y-2 pl-1">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="label">{t('chart.color')}</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="color"
                      className="w-7 h-6 rounded cursor-pointer border-0 bg-transparent"
                      value={mapping.color || getPalette(chart.style.palette)[0]}
                      onChange={(e) => patch({ color: e.target.value })}
                    />
                    <button className="btn !px-1.5 !py-0.5 text-[10px]" onClick={() => patch({ color: '' })}>
                      {t('chart.auto')}
                    </button>
                  </div>
                </div>
                <div>
                  <span className="label">{t('chart.opacity')} · {mapping.opacity}</span>
                  <input
                    type="range"
                    className="w-full accent-(--color-accent)"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={mapping.opacity}
                    onChange={(e) => patch({ opacity: Number(e.target.value) })}
                  />
                </div>
                {isXY && (
                  <div>
                    <span className="label">{t('chart.lineStyle')}</span>
                    <select
                      className="input"
                      value={mapping.lineStyle}
                      onChange={(e) => patch({ lineStyle: e.target.value as SeriesMapping['lineStyle'] })}
                    >
                      <option value="solid">———</option>
                      <option value="dashed">– – –</option>
                      <option value="dotted">·····</option>
                    </select>
                  </div>
                )}
                {isXY && (
                  <div>
                    <span className="label">{t('chart.symbol')}</span>
                    <select
                      className="input"
                      value={mapping.symbol}
                      onChange={(e) => patch({ symbol: e.target.value as SeriesMapping['symbol'] })}
                    >
                      <option value="">{t('chart.auto')}</option>
                      <option value="circle">●</option>
                      <option value="emptyCircle">○</option>
                      <option value="rect">■</option>
                      <option value="triangle">▲</option>
                      <option value="diamond">◆</option>
                      <option value="none">{t('chart.none')}</option>
                    </select>
                  </div>
                )}
              </div>
              {(chart.type === 'line' || chart.type === 'scatter' || chart.type === 'area') && mapping.errCol >= 0 && (
                <div>
                  <span className="label">{t('chart.errorDisplay')}</span>
                  <select
                    className="input"
                    value={mapping.errorDisplay}
                    onChange={(e) => patch({ errorDisplay: e.target.value as SeriesMapping['errorDisplay'] })}
                  >
                    <option value="bars">{t('chart.errBars')}</option>
                    <option value="band">{t('chart.errBand')}</option>
                  </select>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

