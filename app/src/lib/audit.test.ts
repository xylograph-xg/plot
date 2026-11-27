import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { init } from 'echarts';
import type { FitModelKind } from '../types';
import { defaultChart, defaultSeries } from '../store/useStore';
import { scanRowFilter } from './autoStart';
import { chartPreset } from './chartPresets';
import type { MeasurementSeries } from './chartSelection';
import { buildChartOption } from './echartsOption';
import { parseProject } from './export';
import { leastSquares } from './fitLeastSquares';
import { fitCurve } from './fitModels';
import { spectrumPositionNumber } from './fitResultText';
import { datasetFromTable, inspectFile, parseCell, toImportTable } from './parse';
import { chartPlotRect, projectChartSelection } from './projectChartSelection';
import { datasetView } from './rowFilter';
import { hc, spectralAxisPatch } from './spectralAxis';
import { calculateSpectrum, fitSpectrum, spectrumAdjustmentKey, spectrumPeaks } from './spectrum';
import { extent, histogram, linearRegression, pearson } from './stats';
import { calculateTrendline } from './trendline';

const functions: Record<FitModelKind, (x: number) => number> = {
  linear: (x) => 2 * x + 3,
  quadratic: (x) => x ** 2 - x + 2,
  cubic: (x) => x ** 3 - x ** 2 + x,
  quartic: (x) => 0.2 * x ** 4 + 2 * x ** 2 - x,
  quintic: (x) => 0.1 * x ** 5 - x ** 3 + 2,
  logarithmic: (x) => 4 + 2 * Math.log(x),
  reciprocal: (x) => 4 + 2 / x,
  squareRoot: (x) => 3 + Math.sqrt(x),
  exponential: (x) => 3 * Math.exp(-0.4 * x),
  exponentialGrowth: (x) => 2 + 3 * Math.exp(0.4 * x),
  exponentialDecay: (x) => 2 + 3 * Math.exp(-0.4 * x),
  doubleExponential: (x) => 3 * Math.exp(-0.7 * x) + 4 * Math.exp(-0.1 * x),
  doubleExponentialDecay: (x) => 1 + 3 * Math.exp(-0.7 * x) + 4 * Math.exp(-0.1 * x),
  power: (x) => 3 * x ** 1.5,
  gaussian: (x) => 2 + 5 * Math.exp(-0.5 * ((x - 4) / 0.8) ** 2),
  lorentzian: (x) => 2 + 5 / (1 + ((x - 4) / 0.8) ** 2),
  logistic: (x) => 2 + 5 / (1 + Math.exp(-1.2 * (x - 4))),
  hill: (x) => 2 + 5 * x ** 2 / (16 + x ** 2),
  sinusoidal: (x) => 2 + 3 * Math.sin(2.5 * x + 0.3),
};

describe('Numerical fits', () => {
  it('recovers linear regression and multicolumn least squares coefficients', () => {
    expect(linearRegression([1, 2, 3, 4], [5, 7, 9, 11])).toMatchObject({ slope: 2, intercept: 3, r2: 1 });
    const solution = leastSquares([[1, 1, 1, 1], [1, 2, 3, 4]], [5, 7, 9, 11]);
    expect(solution?.coefficients[0]).toBeCloseTo(3, 12);
    expect(solution?.coefficients[1]).toBeCloseTo(2, 12);
    expect(leastSquares([[1, 1], [2, 2]], [1, 2])).toBeNull();
  });

  it.each(Object.entries(functions))('recovers a synthetic %s curve', (kind, fn) => {
    const x = Array.from({ length: 81 }, (_, index) => 0.2 + index * 0.1);
    const fit = fitCurve(kind as FitModelKind, x, x.map(fn));
    expect(fit?.r2).toBeGreaterThan(0.9995);
    expect(fit?.predict(3.7)).toBeCloseTo(fn(3.7), 1);
  });

  it('fits a Gaussian spectral peak and calculates all residuals', () => {
    const points = Array.from({ length: 1201 }, (_, index) => ({ x: 0.2 + index / 150, y: 0 }));
    points.forEach((point) => { point.y = functions.gaussian(point.x); });
    const fit = fitSpectrum(points, { seriesId: 's', shape: 'gaussian', count: 1, baseline: 'constant' }, false);
    if ('error' in fit) throw new Error(fit.error);
    expect(fit.peaks[0].center).toBeCloseTo(4, 3);
    expect(fit.peaks[0].fwhm).toBeCloseTo(0.8 * Math.sqrt(8 * Math.log(2)), 3);
    expect(fit.r2).toBeGreaterThan(0.99999);
    expect(fit.residuals).toHaveLength(points.length);
  });

  it('labels a weak spectral peak alongside a dominant peak', () => {
    const points = Array.from({ length: 291 }, (_, ri) => {
      const x = 360 + ri;
      const gaussianAt = (center: number) => Math.exp(-0.5 * ((x - center) / 8) ** 2);
      return { x, y: gaussianAt(445) + 0.04 * gaussianAt(535) + 0.003 * (-1) ** ri, ri };
    });
    const measured = { sid: 's', mapping: defaultSeries('d'), name: 'Spectrum', points };
    const centers = spectrumPeaks(defaultChart(), measured).map(({ x }) => x);
    expect(centers).toHaveLength(2);
    expect(Math.abs(centers[0] - 445)).toBeLessThanOrEqual(1);
    expect(Math.abs(centers[1] - 535)).toBeLessThanOrEqual(1);
  });

  it('reports log-normal parameters and marks each center in its component color', () => {
    const center = 480.1267;
    const rows = Array.from({ length: 221 }, (_, index) => {
      const x = 420 + index;
      const shifted = 0.75 * (x - center) / 15;
      const peak = shifted <= -1 ? 0 : 3 * Math.exp(-0.5 * (Math.log1p(shifted) / 0.75) ** 2);
      return [x, peak + 0.1 + 0.002 * x];
    });
    const dataset = { id: 'd', name: 'Log normal', columns: ['Wavelength (nm)', 'Intensity'], rows };
    const mapping = { ...defaultSeries(dataset.id), trendline: 'none' as const };
    const config = { seriesId: mapping.id, shape: 'logNormal' as const, count: 1, centers: [480], baseline: 'linear' as const };
    const result = fitSpectrum(rows.map(([x, y]) => ({ x, y })), config, false);
    if ('error' in result) throw new Error(result.error);
    const [peak] = result.peaks;
    expect(peak.center).toBeCloseTo(center, 3);
    expect(peak.height).toBeCloseTo(3, 4);
    expect(peak.shift).toBeCloseTo(center - 20, 3);
    expect(peak.width).toBeCloseTo(15, 3);
    expect(peak.extra).toBeCloseTo(0.75, 4);
    expect(result.background.intercept).toBeCloseTo(0.1, 4);
    expect(result.background.slope).toBeCloseTo(0.002, 6);

    const chart = { ...defaultChart(), series: [mapping], spectrumFits: [config], showSpectrumComponents: true };
    const series = buildChartOption(chart, [dataset]).series;
    if (!Array.isArray(series)) throw new Error('Missing chart series');
    const component = series[2];
    if (component.type !== 'line') throw new Error('Missing peak component');
    expect(series[1]).not.toHaveProperty('markLine');
    expect(series[3]).toMatchObject({ name: component.name, itemStyle: { color: component.lineStyle?.color },
      data: [{ name: 'x_c = 480.1' }] });
    expect(series[4]).toMatchObject({ name: component.name, itemStyle: { color: component.lineStyle?.color },
      data: [{ name: 'x₀ = 460.1', value: [expect.closeTo(center - 20, 3), 0] }] });
    expect(buildChartOption({ ...chart, showSpectrumComponents: false }, [dataset]).series).toHaveLength(2);
  });

  it('recomputes the total and residuals from adjusted peaks and saves their axis-specific parameters', () => {
    const chart = defaultChart();
    const points = Array.from({ length: 101 }, (_, ri) => {
      const x = 400 + ri;
      return { x, y: 2 * Math.exp(-0.5 * ((x - 450) / 8) ** 2), ri };
    });
    const mapping = defaultSeries('d');
    const series = { sid: 's', mapping, name: 'Spectrum', points };
    const key = spectrumAdjustmentKey(chart, mapping);
    const parameters = { peaks: [{ center: 450, width: 8, height: 1 }], background: { intercept: 0, slope: 0 } };
    const fit = { seriesId: mapping.id, shape: 'gaussian' as const, count: 1, baseline: 'zero' as const,
      adjustments: { [key]: parameters } };
    const adjusted = calculateSpectrum(chart, series, fit);
    if ('error' in adjusted) throw new Error(adjusted.error);
    expect(adjusted.peaks[0].height).toBe(1);
    expect(adjusted.total).toContainEqual([450, 1]);
    expect(adjusted.residuals).toContainEqual([450, 1]);
    expect(adjusted.r2).toBeLessThan(0.8);
    const restored = calculateSpectrum(chart, series, { ...fit, adjustments: undefined });
    if ('error' in restored) throw new Error(restored.error);
    expect(restored.r2).toBeGreaterThan(0.9999);
    const saved = { ...chart, series: [mapping], spectrumFits: [fit] };
    const converted = { ...saved, ...spectralAxisPatch(saved, 'wavelengthToEnergy') };
    expect(spectrumAdjustmentKey(converted, mapping)).not.toBe(key);
    expect(spectralAxisPatch(converted).spectrumFits?.[0].adjustments?.[key]).toEqual(parameters);
    const project = parseProject(JSON.stringify({ app: 'sciplot', version: 3, datasets: [], charts: [saved] }));
    expect(project.charts[0].spectrumFits?.[0].adjustments?.[key]).toEqual(parameters);
  });

  it('rounds spectral labels to the display unit and preserves small nonzero widths', () => {
    expect(spectrumPositionNumber(506, 'nm')).toBe('506');
    expect(spectrumPositionNumber(2.449762, 'eV')).toBe('2.45');
    expect(spectrumPositionNumber(2.491762, 'eV')).toBe('2.492');
    expect(spectrumPositionNumber(0.0001287, 'eV')).toBe('0.00013');
    expect(spectrumPositionNumber(0.167834)).toBe('0.1678');
  });

  it('uses original points for trendline residuals and R² after sampling', () => {
    const chart = defaultChart();
    const points = Array.from({ length: 1500 }, (_, ri) => {
      const x = 0.1 + ri / 160;
      return { ri, x, y: functions.gaussian(x) + (ri === 1 ? 11 : 0) };
    });
    const result = calculateTrendline(chart, { sid: 's', mapping: defaultSeries('d'), name: 's', points }, 'gaussian');
    expect(result.residuals).toHaveLength(points.length);
    expect(result.fit?.r2).toBeLessThan(0.99);
    expect(result.fit?.r2).toBeGreaterThan(0.9);
  });
});

describe('Import and chart regression checks', () => {
  it('selects plotted coordinates and retains original row numbers after screening and normalization', () => {
    const dataset = { id: 'd', name: 'Measured', columns: ['X', 'Signal'],
      rows: [[10, 100], [20, 4], [30, 8], [40, 2]], rowFilter: { first: 2 } };
    const chart = { ...defaultChart(), series: [{ ...defaultSeries(dataset.id), normalization: 'max' as const, trendline: 'none' as const }] };
    const measurements: MeasurementSeries[] = [];
    const inst = init(null, undefined, { renderer: 'svg', ssr: true, width: 450, height: 340 });
    try {
      inst.setOption(buildChartOption(chart, [datasetView(dataset)], undefined, { measurements }));
      const grid = chartPlotRect(inst)!;
      const left = inst.convertToPixel({ xAxisIndex: 0 }, 25);
      const right = inst.convertToPixel({ xAxisIndex: 0 }, 35);
      const bounds = { x: (left - grid.x) / grid.width, y: 0, width: (right - left) / grid.width, height: 1 };
      expect(projectChartSelection(inst, grid, bounds, measurements, [dataset], {}, chart.type).points).toEqual([
        { x: 30, y: 1, row: 2, series: 'Signal', datasetId: dataset.id },
      ]);
      expect(projectChartSelection(inst, grid, bounds, measurements, [dataset], { Signal: false }, chart.type).points).toEqual([]);
    } finally {
      inst.dispose();
    }
  });

  it('preserves text identifiers and recognizes an instrument preamble', () => {
    expect(parseCell(' 001 ')).toBe('001');
    expect(parseCell('1.25e2')).toBe(125);
    expect(parseCell(' ')).toBeNull();
    expect(datasetFromTable(toImportTable('data', [['ID', 'Signal'], ['001', '1.2'], ['12', '']], true), 'd'))
      .toMatchObject({ columns: ['ID', 'Signal'], textColumns: [0], rows: [['001', 1.2], ['12', null]] });
    const preamble = toImportTable('scan', [['X axis', 'nm'], ['Y axis', 'Signal'], ['Start', '1'], ['Stop', '5'], ['1', '2']], true);
    expect(preamble).toMatchObject({ fixedHeader: true, skippedPreambleRows: 4, columns: ['nm', 'Signal'], rows: [['1', '2']] });
  });

  it('reads lazy Excel sheets and keeps number formats in identifier columns', async () => {
    const workbook = XLSX.utils.book_new();
    const first = XLSX.utils.aoa_to_sheet([['ID', 'Y'], [7, 12.34], [42, 3]]);
    first.A2.z = '0000';
    XLSX.utils.book_append_sheet(workbook, first, 'One');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['X', 'Y'], [1, 2]]), 'Two');
    const buffer: ArrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const sheets = await inspectFile({ name: 'book.xlsx', buffer }, true);
    expect(sheets.map(({ sheet }) => sheet)).toEqual(['One', 'Two']);
    expect(datasetFromTable(sheets[0].read(), 'd').rows).toEqual([['0007', 12.34], ['42', 3]]);
    expect(datasetFromTable(sheets[1].read(), 'e').rows).toEqual([[1, 2]]);
  });

  it('detects the start row and respects a final row filter', () => {
    const dataset = { id: 'd', name: 'scan', columns: ['signal'], rows: [10, 10, 10, 10, 10, 2, 2, 2, 2, 2].map((y) => [y]) };
    const rule = { column: 0, plateauPoints: 5, mode: 'drop' as const };
    expect(scanRowFilter(dataset, rule)).toMatchObject({ first: 6, autoStart: rule });
    expect(scanRowFilter({ ...dataset, rowFilter: { last: 5 } }, rule)).toBe('beyondEnd');
  });

  it('restores saved axis bounds even when equivalent limits are formatted differently', () => {
    const defaults = defaultChart();
    const original = { ...defaults, xAxis: { ...defaults.xAxis, label: 'nm', min: '400.0', max: '700.00' } };
    const converted = { ...original, ...spectralAxisPatch(original, 'wavelengthToEnergy', false, 'eV') };
    expect(Number(converted.xAxis.min)).toBeCloseTo(hc / 700, 12);
    converted.xAxis.max = Number(converted.xAxis.max).toFixed(15);
    expect(spectralAxisPatch(converted).xAxis).toMatchObject({ label: 'nm', min: '400.0', max: '700.00' });
  });

  it('starts phosphorescence spectra as normalized scatter plots and hides groups without removing their mappings', () => {
    const dataset = { id: 'd', name: 'Spectrum', columns: ['Wavelength (nm)', 'Intensity', 'Temperature'],
      rows: [[400, -20, '110 K'], [450, 10, '110 K'], [650, 6, '220 K'], [700, 12, '220 K'], [900, null, '110 K']] };
    const original = defaultChart();
    const preset = chartPreset('spectrum', original, [dataset], defaultSeries);
    if (typeof preset === 'string') throw new Error(preset);
    const chart = { ...original, ...preset };
    expect(chart).toMatchObject({ type: 'scatter', showPeakPositions: true, showSpectrumSettings: true, spectrumFits: [],
      series: [{ trendline: 'none', normalization: 'max' }] });
    expect(buildChartOption(chart, [dataset]).series).toMatchObject([
      { type: 'scatter', name: '110 K', data: [[400, -2, 0, 0], [450, 1, 1, 0]] },
      { type: 'scatter', name: '220 K', data: [[650, 0.5, 2, 0], [700, 1, 3, 0]] },
    ]);

    const hidden = { ...chart, series: [{ ...chart.series[0], hiddenGroups: ['220 K'] }] };
    expect(buildChartOption(hidden, [dataset]).series).toMatchObject([{ name: '110 K' }]);
    expect(buildChartOption(chart, [dataset]).series).toHaveLength(2);
  });

  it('migrates the original single fit field on import', () => {
    const fit = { seriesId: 's', shape: 'gaussian', count: 1 };
    const project = parseProject(JSON.stringify({ app: 'sciplot', version: 2, datasets: [], charts: [{ spectrumFit: fit }] }));
    expect(project.charts[0]).toEqual({ spectrumFits: [fit] });
  });

  it('builds a heatmap with over 125,000 cells and computes pairwise statistics', () => {
    const chart = { ...defaultChart(), type: 'heatmap' as const, series: [defaultSeries('d')] };
    const dataset = { id: 'd', name: 'large', columns: Array.from({ length: 10 }, (_, col) => String(col)),
      rows: Array.from({ length: 15_000 }, (_, row) => Array.from({ length: 10 }, (_, col) => row + col)) };
    expect(buildChartOption(chart, [dataset]).series).toMatchObject([{ type: 'heatmap', data: expect.any(Array) }]);
    const data = Float64Array.from({ length: 150_000 }, (_, index) => index);
    expect(extent(data)).toEqual([0, 149_999]);
    expect(histogram(Array.from(data), 10).reduce((total, bin) => total + bin.count, 0)).toBe(150_000);
    expect(pearson([1, NaN, 2, 3], [3, 9, 2, 1])).toBeCloseTo(-1, 12);
  });
});
