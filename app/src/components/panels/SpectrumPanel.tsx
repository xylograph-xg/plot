import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartConfig, Dataset, SpectrumBaseline, SpectrumFitConfig, SpectrumShape } from '../../types';
import { useStore } from '../../store/useStore';
import { datasetView } from '../../lib/rowFilter';
import { normalizedSeries } from '../../lib/normalization';
import { fitNumber } from '../../lib/fitResultText';
import {
  activeSpectrumFits, calculateSpectrum, isSpectrumTarget, maxSpectrumPeaks, spectrumBaselines, spectrumShapes,
} from '../../lib/spectrum';
import { spectralColumnUnit, spectralOutputUnit } from '../../lib/spectralAxis';
import { hasCategoricalX, resolveChartSeries, type ResolvedSeries } from '../../lib/xySeries';

function SpectrumSettings({ curve, fits, unit, onChange }: {
  curve: ResolvedSeries;
  fits: SpectrumFitConfig[];
  unit?: string;
  onChange: (fits: SpectrumFitConfig[]) => void;
}) {
  const { t } = useTranslation();
  const [selectedBaseline, setSelectedBaseline] = useState<SpectrumBaseline>();
  const [selectedCount, setSelectedCount] = useState<number>();
  const [centerInput, setCenterInput] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const first = fits[0];
  const baseline = selectedBaseline ?? (first ? first.baseline ?? 'linear' : 'constant');
  const count = selectedCount ?? first?.count ?? 2;
  const centers = centerInput ?? first?.centers?.map((center) => fitNumber(center, 9)).join(', ') ?? '';

  const apply = (shapes: SpectrumShape[]) => {
    const guesses = centerInput === undefined ? first?.centers
      : centerInput.trim() ? centerInput.trim().split(/[\s,，;；]+/).filter(Boolean).map(Number) : undefined;
    if (guesses && (guesses.length !== count || !guesses.every(Number.isFinite))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(shapes.map((shape) => ({
      seriesId: curve.mapping.id, group: curve.mapping.groupCol >= 0 ? curve.name : undefined,
      shape, baseline, count, centers: guesses,
    })));
  };
  const toggle = (shape: SpectrumShape) => {
    if (fits.some((fit) => fit.shape === shape)) {
      onChange(fits.filter((fit) => fit.shape !== shape));
    } else {
      apply([...fits.map((fit) => fit.shape), shape]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_4.5rem] gap-1.5">
        <label>
          <span className="label">{t('spectrum.baseline')}</span>
          <select className="input" value={baseline}
            onChange={(event) => setSelectedBaseline(event.target.value as SpectrumBaseline)}>
            {spectrumBaselines.map((kind) => <option key={kind} value={kind}>{t(`spectrum.baselines.${kind}`)}</option>)}
          </select>
        </label>
        <label>
          <span className="label">{t('spectrum.count')}</span>
          <select className="input" value={count} onChange={(event) => setSelectedCount(Number(event.target.value))}>
            {Array.from({ length: maxSpectrumPeaks }, (_, index) => <option key={index}>{index + 1}</option>)}
          </select>
        </label>
      </div>
      <label>
        <span className="label">{t('spectrum.centers')}{unit ? ` · ${unit}` : ''}</span>
        <input className="input" value={centers}
          placeholder={t(unit === 'eV' ? 'spectrum.energyCentersHint' : 'spectrum.centersHint')}
          onChange={(event) => { setCenterInput(event.target.value); setInvalid(false); }} />
      </label>
      {invalid && <p role="alert" className="text-[11px] text-red-500">{t('spectrum.centersError')}</p>}
      <div>
        <div className="label">{t('spectrum.shape')}</div>
        <div role="group" aria-label={t('spectrum.shape')} className="flex flex-wrap gap-1">
          {spectrumShapes.map((shape) => (
            <button key={shape} className="btn !px-1.5 text-(--text-3) aria-pressed:!border-accent aria-pressed:!text-accent"
              aria-pressed={fits.some((fit) => fit.shape === shape)} onClick={() => toggle(shape)}>
              {t(`spectrum.shapes.${shape}`)}
            </button>
          ))}
        </div>
      </div>
      {fits.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button className="btn" onClick={() => apply(fits.map((fit) => fit.shape))}>{t('spectrum.update')}</button>
          <button className="btn" onClick={() => onChange([])}>{t('spectrum.clear')}</button>
        </div>
      )}
    </div>
  );
}

export function SpectrumPanel({ chart, datasets }: { chart: ChartConfig; datasets: Dataset[] }) {
  const { t } = useTranslation();
  const updateChart = useStore((state) => state.updateChart);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>();
  const fits = activeSpectrumFits(chart);
  const displayUnit = (curve: ResolvedSeries) => {
    if (chart.spectralAxis) return spectralOutputUnit(chart.spectralAxis.direction);
    const column = datasets.find(({ id }) => id === curve.mapping.datasetId)?.columns[curve.mapping.xCol];
    const unit = column ? spectralColumnUnit(column) : undefined;
    return unit === 'unsupported' ? undefined : unit;
  };
  const curves = useMemo(() => {
    if (!open) return [];
    const ids = new Set(chart.series.map(({ datasetId }) => datasetId));
    const views = datasets.filter(({ id }) => ids.has(id)).map(datasetView);
    const resolved = resolveChartSeries(chart, views);
    return hasCategoricalX(resolved) ? [] : resolved.filter(({ points }) => points.length > 0);
  }, [chart, datasets, open]);
  const selected = curves.find(({ sid }) => sid === target) ??
    curves.find((curve) => fits.some((fit) => isSpectrumTarget(fit, curve))) ?? curves[0];
  const selectedFits = selected ? fits.filter((fit) => isSpectrumTarget(fit, selected)) : [];
  const selectedUnit = selected ? displayUnit(selected) : undefined;

  return (
    <section className="mx-3 my-2 space-y-2 rounded-lg border border-(--border) p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <label className="flex items-center gap-1.5 text-[11px]">
          <input type="checkbox" checked={chart.showPeakPositions ?? false}
            onChange={(event) => updateChart(chart.id, { showPeakPositions: event.target.checked })} />
          {t('spectrum.markPeaks')}
        </label>
        <button className="btn !px-1.5" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t('spectrum.fit')} {open ? '−' : '+'}
        </button>
      </div>
      {open && (
        <div className="space-y-2">
          <label>
            <span className="label">{t('spectrum.curve')}</span>
            <select className="input" value={selected?.sid ?? ''} disabled={!curves.length}
              onChange={(event) => setTarget(event.target.value)}>
              {!curves.length && <option value="">{t('spectrum.numericX')}</option>}
              {curves.map((curve) => (
                <option key={curve.sid} value={curve.sid}>{curve.name}
                  {curves.some((other) => other.sid !== curve.sid && other.name === curve.name)
                    ? ` · ${datasets.find(({ id }) => id === curve.mapping.datasetId)?.name ?? ''}` : ''}
                </option>
              ))}
            </select>
          </label>
          {selected && <SpectrumSettings key={`${selected.sid}:${chart.spectralAxis?.direction ?? 'original'}`} curve={selected}
            fits={selectedFits} unit={selectedUnit}
            onChange={(next) => updateChart(chart.id, {
              spectrumFit: undefined, spectrumFits: [...fits.filter((fit) => !isSpectrumTarget(fit, selected)), ...next],
            })} />}
          {fits.length > 0 && (
            <label className="flex items-center gap-1.5 text-[11px]">
              <input type="checkbox" checked={chart.showSpectrumComponents ?? fits.length === 1}
                onChange={(event) => updateChart(chart.id, { showSpectrumComponents: event.target.checked })} />
              {t('spectrum.showComponents')}
            </label>
          )}
          {fits.map((fit) => {
            const fitted = curves.find((curve) => isSpectrumTarget(fit, curve));
            if (!fitted) return null;
            const unit = displayUnit(fitted);
            const result = calculateSpectrum(chart, normalizedSeries(fitted), fit);
            const name = t(`spectrum.shapes.${fit.shape}`);
            return (
              <div key={JSON.stringify([fit.seriesId, fit.group, fit.shape])} role="status"
                className="space-y-1.5 rounded border border-(--border) p-1.5 text-[11px] text-(--text-2)">
                <p><strong>{fitted.name}</strong> · {name}{'error' in result ? '' : ` · R² = ${fitNumber(result.r2, 5)}`}</p>
                {'error' in result ? <p>{t(`spectrum.errors.${result.error}`)}</p> : (
                  <>
                    <p>{t('spectrum.resultHint', { count: result.count, baseline: t(`spectrum.baselines.${fit.baseline ?? 'linear'}`) })}</p>
                    <table className="w-full text-left">
                      <thead>
                        <tr>
                          <th>{t('spectrum.peak')}</th><th>{t('spectrum.center')}{unit ? ` (${unit})` : ''}</th>
                          <th>FWHM</th><th>{t('spectrum.height')}</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {result.peaks.map(({ center, height, fwhm }, index) => (
                          <tr key={index}>
                            <td>{index + 1}</td><td>{fitNumber(center, 7)}</td>
                            <td>{fitNumber(fwhm, 5)}</td><td>{fitNumber(height, 5)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
