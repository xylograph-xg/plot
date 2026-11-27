import { useFitResults } from '../chart/useFitResults';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartConfig, Dataset, SpectrumBaseline, SpectrumFitConfig, SpectrumParameters, SpectrumShape } from '../../types';
import { useStore } from '../../store/useStore';
import { datasetView } from '../../lib/rowFilter';
import { normalizedSeries } from '../../lib/normalization';
import { fitNumber, spectrumPositionNumber } from '../../lib/fitResultText';
import {
  activeSpectrumFits, isSpectrumTarget, maxSpectrumPeaks, spectrumBaselines, spectrumShapes,
  spectrumAdjustmentKey, spectrumExtraParameter, validSpectrumParameters, type SpectrumResult,
} from '../../lib/spectrum';
import { spectralSeriesUnit, type SpectralUnit } from '../../lib/spectralAxis';
import { hasCategoricalX, isCurveVisible, resolveChartSeries, type ResolvedSeries } from '../../lib/xySeries';

function SpectrumSettings({ curve, fits, unit, onChange }: {
  curve: ResolvedSeries;
  fits: SpectrumFitConfig[];
  unit?: SpectralUnit;
  onChange: (fits: SpectrumFitConfig[]) => void;
}) {
  const { t } = useTranslation();
  const [selectedBaseline, setSelectedBaseline] = useState<SpectrumBaseline>();
  const [selectedCount, setSelectedCount] = useState<number>();
  const [centerInput, setCenterInput] = useState<string[]>();
  const [invalid, setInvalid] = useState(false);
  const first = fits[0];
  const baseline = selectedBaseline ?? (first ? first.baseline ?? 'linear' : 'zero');
  const count = selectedCount ?? first?.count ?? 2;
  const centers = centerInput ?? first?.centers?.map(String) ?? [];
  const fields = Array.from({ length: count }, (_, index) => centers[index] ?? '');

  const apply = (shapes: SpectrumShape[], preserveAdjustments = false) => {
    const guesses = fields.some((value) => value.trim()) ? fields.map((value) => value.trim() ? Number(value) : NaN) : undefined;
    if (guesses && !guesses.every(Number.isFinite)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(shapes.map((shape) => {
      const existing = fits.find((fit) => fit.shape === shape);
      return {
        seriesId: curve.mapping.id, group: curve.mapping.groupCol >= 0 ? curve.name : undefined,
        shape, baseline, count, centers: guesses,
        adjustments: preserveAdjustments && existing?.count === count && (existing.baseline ?? 'linear') === baseline
          ? existing.adjustments : undefined,
      };
    }));
  };
  const toggle = (shape: SpectrumShape) => {
    if (fits.some((fit) => fit.shape === shape)) {
      onChange(fits.filter((fit) => fit.shape !== shape));
    } else {
      apply([...fits.map((fit) => fit.shape), shape], true);
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
          <select className="input" value={count} onChange={(event) => {
            setSelectedCount(Number(event.target.value));
            setInvalid(false);
          }}>
            {Array.from({ length: maxSpectrumPeaks }, (_, index) => <option key={index}>{index + 1}</option>)}
          </select>
        </label>
      </div>
      <fieldset>
        <legend className="label">{t('spectrum.centers')}{unit ? ` · ${unit}` : ''}</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {fields.map((value, index) => (
            <label key={index} className="flex items-center gap-1.5 text-[11px]">
              <span aria-hidden="true">{index + 1}</span>
              <input className="input min-w-0" inputMode="decimal" value={value} aria-invalid={invalid}
                aria-label={t('spectrum.centerFor', { index: index + 1 })} placeholder={t('style.auto')}
                onChange={(event) => {
                  setCenterInput(Array.from({ length: Math.max(count, centers.length) }, (_, i) =>
                    i === index ? event.target.value : centers[i] ?? ''));
                  setInvalid(false);
                }} />
            </label>
          ))}
        </div>
      </fieldset>
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

type SuccessfulSpectrum = Exclude<SpectrumResult, { error: string }>;

function LogNormalParameters({ result, baseline, unit }: {
  result: SuccessfulSpectrum;
  baseline?: SpectrumBaseline;
  unit?: SpectralUnit;
}) {
  const { t } = useTranslation();
  const xValue = (value: number) => `${spectrumPositionNumber(value, unit)}${unit ? ` ${unit}` : ''}`;
  return (
    <div className="space-y-1.5">
      <div className="font-semibold">{t('spectrum.parameters.title')}</div>
      <p className="font-mono">
        b₀ = {fitNumber(result.background.intercept, 4)}
        {(baseline ?? 'linear') === 'linear' && ` · b₁ = ${fitNumber(result.background.slope, 4)}`}
      </p>
      {result.peaks.map(({ center, height, fwhm, width, extra, shift }, index) => {
        const parameters = [
          [t('spectrum.logNormal.center'), xValue(center)],
          [t('spectrum.logNormal.shift'), shift === undefined ? '—' : xValue(shift)],
          [t('spectrum.logNormal.width'), xValue(width)],
          [t('spectrum.logNormal.skew'), fitNumber(extra ?? 0, 4)],
          [t('spectrum.logNormal.amplitude'), fitNumber(height, 4)],
          ['FWHM', xValue(fwhm)],
        ];
        return (
          <div key={index} className="space-y-1 border-t border-(--border) pt-1.5">
            <div className="font-medium">{t('spectrum.component', { index: index + 1 })}</div>
            <dl className="grid grid-cols-2 gap-x-2 gap-y-1">
              {parameters.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-(--text-3)">{label}</dt>
                  <dd className="wrap-anywhere font-mono">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function SpectrumParameterEditor({ parameters, fit, unit, onApply }: {
  parameters: SpectrumParameters;
  fit: SpectrumFitConfig;
  unit?: SpectralUnit;
  onApply: (parameters: SpectrumParameters) => void;
}) {
  const { t } = useTranslation();
  const [invalid, setInvalid] = useState(false);
  const changed = useRef(new Set<string>());
  const baseline = fit.baseline ?? 'linear';
  const extra = spectrumExtraParameter(fit.shape);
  const axisUnit = unit ? ` (${unit})` : '';
  const input = (name: string, label: string, value: number, position = false) => (
    <label className="min-w-0">
      <span className="label">{label}</span>
      <input name={name} inputMode="decimal" className="input min-w-0" title={String(value)}
        defaultValue={position ? spectrumPositionNumber(value, unit) : fitNumber(value, 4)}
        onChange={() => { changed.current.add(name); if (invalid) setInvalid(false); }} />
    </label>
  );
  return (
    <form className="space-y-2" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const value = (field: string, fitted: number) => {
        if (!changed.current.has(field)) return fitted;
        const text = String(form.get(field) ?? '').trim();
        return text ? Number(text) : NaN;
      };
      const next: SpectrumParameters = {
        peaks: parameters.peaks.map((peak, index) => ({
          center: value(`center-${index}`, peak.center), width: value(`width-${index}`, peak.width),
          height: value(`height-${index}`, peak.height), extra: extra ? value(`extra-${index}`, peak.extra ?? 0) : undefined,
        })),
        background: { intercept: baseline === 'zero' ? 0 : value('intercept', parameters.background.intercept),
          slope: baseline === 'linear' ? value('slope', parameters.background.slope) : 0 },
      };
      if (!validSpectrumParameters(fit.shape, fit.count, next)) {
        setInvalid(true);
        return;
      }
      setInvalid(false);
      onApply(next);
    }}>
      {baseline !== 'zero' && <fieldset className="grid grid-cols-2 gap-1.5">
        <legend className="label">{t('spectrum.baseline')}</legend>
        {input('intercept', t('spectrum.parameters.intercept'), parameters.background.intercept)}
        {baseline === 'linear' && input('slope', t('spectrum.parameters.slope'), parameters.background.slope)}
      </fieldset>}
      {parameters.peaks.map((peak, index) => (
        <fieldset key={index} className="grid grid-cols-2 gap-1.5">
          <legend className="label">{t('spectrum.component', { index: index + 1 })}</legend>
          {input(`center-${index}`, t('spectrum.logNormal.center') + axisUnit, peak.center, true)}
          {input(`height-${index}`, t('spectrum.logNormal.amplitude'), peak.height)}
          {input(`width-${index}`, t(fit.shape === 'splitGaussian' ? 'spectrum.parameters.leftWidth' : 'spectrum.logNormal.width') +
            axisUnit, peak.width, true)}
          {extra && input(`extra-${index}`, t(`spectrum.parameters.${extra}`) + (extra === 'skew' ? '' : axisUnit),
            peak.extra ?? 0, extra !== 'skew')}
        </fieldset>
      ))}
      {invalid && <p role="alert" className="text-red-500">{t('spectrum.errors.parameters')}</p>}
      <button type="submit" className="btn-primary !py-1">{t('spectrum.parameters.apply')}</button>
    </form>
  );
}

function SpectrumResultCard({ name, fit, result, unit, adjustmentKey, onAdjust }: {
  name: string;
  fit: SpectrumFitConfig;
  result?: SpectrumResult;
  unit?: SpectralUnit;
  adjustmentKey: string;
  onAdjust: (parameters?: SpectrumParameters) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const adjusted = fit.adjustments?.[adjustmentKey];
  const success = result && !('error' in result) ? result : undefined;
  const editable = success ?? (result ? adjusted : undefined);
  return (
    <div className="space-y-1.5 rounded border border-(--border) p-1.5 text-[11px] text-(--text-2)">
      <p role="status"><strong>{name}</strong> · {t(`spectrum.shapes.${fit.shape}`)}
        {success ? ` · R² = ${fitNumber(success.r2, 4)}` : ''}
        {adjusted && ` · ${t('spectrum.parameters.adjusted')}`}
      </p>
      {!result && <p role="status">{t('fit.calculating')}</p>}
      {result && 'error' in result && <p role="status">{t(`spectrum.errors.${result.error}`)}</p>}
      {success && (
        <>
          <p>{t('spectrum.resultHint', { count: success.count, baseline: t(`spectrum.baselines.${fit.baseline ?? 'linear'}`) })}</p>
          {fit.shape === 'logNormal' ? <LogNormalParameters result={success} baseline={fit.baseline} unit={unit} /> : (
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th>{t('spectrum.peak')}</th><th>{t('spectrum.center')}{unit ? ` (${unit})` : ''}</th>
                  <th>FWHM</th><th>{t('spectrum.height')}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {success.peaks.map(({ center, height, fwhm }, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td><td>{spectrumPositionNumber(center, unit)}</td>
                    <td>{spectrumPositionNumber(fwhm, unit)}</td><td>{fitNumber(height, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-1.5">
        {editable && <button type="button" className="btn" aria-expanded={editing}
          onClick={() => setEditing(!editing)}>{t('spectrum.parameters.edit')}</button>}
        {adjusted && <button type="button" className="btn" onClick={() => { setEditing(false); onAdjust(); }}>
          {t('spectrum.parameters.reset')}
        </button>}
      </div>
      {editing && editable && <SpectrumParameterEditor key={JSON.stringify([editable.background,
        editable.peaks.map(({ center, width, height, extra }) => [center, width, height, extra])])}
        parameters={editable} fit={fit} unit={unit} onApply={onAdjust} />}
    </div>
  );
}

export function SpectrumPanel({ chart, datasets }: { chart: ChartConfig; datasets: Dataset[] }) {
  const { t } = useTranslation();
  const updateChart = useStore((state) => state.updateChart);
  const open = chart.showSpectrumSettings ?? chart.showPeakPositions ?? false;
  const [target, setTarget] = useState<string>();
  const fits = activeSpectrumFits(chart);
  const displayUnit = ({ mapping }: ResolvedSeries) => spectralSeriesUnit(chart,
    datasets.find(({ id }) => id === mapping.datasetId)?.columns[mapping.xCol]);
  const curves = useMemo(() => {
    if (!open) return [];
    const ids = new Set(chart.series.map(({ datasetId }) => datasetId));
    const views = datasets.filter(({ id }) => ids.has(id)).map(datasetView);
    const resolved = resolveChartSeries(chart, views).filter(isCurveVisible);
    return hasCategoricalX(resolved) ? [] : resolved.filter(({ points }) => points.length > 0);
  }, [chart, datasets, open]);
  const fitResults = useFitResults(chart, curves);
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
        <button className="btn !px-1.5" aria-expanded={open}
          onClick={() => updateChart(chart.id, { showSpectrumSettings: !open })}>
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
              spectrumFits: [...fits.filter((fit) => !isSpectrumTarget(fit, selected)), ...next],
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
            const adjustmentKey = spectrumAdjustmentKey(chart, fitted.mapping);
            return <SpectrumResultCard key={JSON.stringify([fit.seriesId, fit.group, fit.shape, adjustmentKey])}
              name={fitted.name} fit={fit} unit={displayUnit(fitted)} adjustmentKey={adjustmentKey}
              result={fitResults.spectrum(normalizedSeries(fitted), fit)}
              onAdjust={(parameters) => {
                const adjustments = { ...fit.adjustments };
                if (parameters) adjustments[adjustmentKey] = parameters;
                else delete adjustments[adjustmentKey];
                updateChart(chart.id, { spectrumFits: fits.map((item) => item === fit
                  ? { ...fit, adjustments: Object.keys(adjustments).length ? adjustments : undefined } : item) });
              }} />;
          })}
        </div>
      )}
    </section>
  );
}
