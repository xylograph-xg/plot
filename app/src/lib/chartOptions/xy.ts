import { format, type EChartsOption, type ScatterSeriesOption, type SeriesOption, type TooltipComponentFormatterCallbackParams } from 'echarts';
import type { ActiveTrendlineKind, AxisConfig, ChartConfig, Dataset, SpectrumFitConfig, SpectrumShape } from '../../types';
import { axisBounds } from '../axisBounds';
import type { MeasurementSeries } from '../chartSelection';
import { chooseFitColor } from '../fitColors';
import { fitAnnotation, fitNumber, spectrumPositionNumber } from '../fitResultText';
import { normalizedSeries } from '../normalization';
import type { FitResidualSeries } from '../residuals';
import { spectralOutputUnit, spectralSeriesUnit, type SpectralUnit } from '../spectralAxis';
import { activeSpectrumFits, calculateSpectrum, isSpectrumTarget, spectrumPeaks } from '../spectrum';
import { extent } from '../stats';
import type { ChartTheme } from '../themes';
import { calculateTrendline } from '../trendline';
import { selectedTrendlines } from '../trendlineSelection';
import { hasCategoricalX, isCurveVisible, resolveChartSeries, supportsTrendline, type ResolvedSeries, type XYPoint } from '../xySeries';
import { axisOption, hexOpacity, LINE_TYPE, numericXAxisOption, type RenderApi } from './shared';

export interface FitLabelOptions {
  rawSeries?: ResolvedSeries[];
  measurements?: MeasurementSeries[];
  size?: () => { width: number; height: number };
  movingAverage?: string;
  model?: (kind: ActiveTrendlineKind) => string;
  spectrum?: {
    total: (shape: SpectrumShape) => string;
    peak: (index: number) => string;
  };
  residuals?: FitResidualSeries[];
  fitResults?: {
    trendline(series: ResolvedSeries, kind: ActiveTrendlineKind): ReturnType<typeof calculateTrendline> | undefined;
    spectrum(series: ResolvedSeries, config: SpectrumFitConfig): ReturnType<typeof calculateSpectrum> | undefined;
  };
  spectralDensity?: (unit: 'eV' | 'nm') => string;
}

const xyDataCache = new WeakMap<ResolvedSeries['points'], Map<number, number[][]>>();

function xyData(series: ResolvedSeries, scatter: boolean, sorted: boolean): number[][] {
  let entries = xyDataCache.get(series.points);
  if (!entries) {
    entries = new Map();
    xyDataCache.set(series.points, entries);
  }
  const key = Number(scatter) + 2 * Number(sorted);
  const cached = entries.get(key);
  if (cached) return cached;
  const points = sorted && !scatter ? [...series.points].sort((a, b) => Number(a.x) - Number(b.x)) : series.points;
  const data = points.map((point) => scatter
    ? [Number(point.x), point.y, point.ri, point.size ?? 0] : [Number(point.x), point.y, point.ri]);
  entries.set(key, data);
  return data;
}

export function buildXY(
  chart: ChartConfig,
  datasets: Dataset[],
  base: EChartsOption,
  legend: object,
  palette: string[],
  theme: ChartTheme,
  normalizedAxisLabel: string,
  fitLabels: FitLabelOptions & { gridTop: number; gridBottom: number },
): EChartsOption {
  const { style } = chart;
  const raw = fitLabels.rawSeries ?? resolveChartSeries(chart, datasets);
  const spectra = activeSpectrumFits(chart);
  const showComponents = chart.showSpectrumComponents ?? spectra.length <= 1;
  const multipleSpectralCurves = new Set(spectra.map(({ seriesId, group }) => JSON.stringify([seriesId, group]))).size > 1;
  const visible = raw.filter(isCurveVisible);
  const resolved = supportsTrendline(chart.type) ? visible.map(normalizedSeries) : visible;
  const rawColors = raw.map(({ mapping }, index) => mapping.color || palette[index % palette.length]);
  const colorByCurve = new Map(raw.map(({ sid }, index) => [sid, rawColors[index]]));
  const usedFitColors = new Set<string>();
  const nameCounts = new Map<string, number>();
  for (const { name } of raw) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  const isBar = chart.type === 'bar' || chart.type === 'barh';
  const horizontal = chart.type === 'barh';
  const categoryX = isBar || hasCategoricalX(visible);

  let categories: string[] | undefined;
  if (categoryX) {
    const set = new Set<string>();
    resolved.forEach((s) => s.points.forEach((p) => set.add(String(p.x))));
    categories = [...set];
  }

  // percent-stack normalization: compute per-category totals
  const usePercent = isBar && style.stack && style.percentStack && categoryX;
  const totals = new Map<string, number>();
  if (usePercent) {
    resolved.forEach((s) =>
      s.points.forEach((p) => {
        const k = String(p.x);
        totals.set(k, (totals.get(k) ?? 0) + Math.abs(p.y));
      }),
    );
  }

  const series: SeriesOption[] = [];
  const measurementAxes = new Map<number, number>();
  const peakMarkers = (id: string, name: string, points: { x: number; y: number; label?: string }[], color: string,
    yAxisIndex: number, index: number, unit?: SpectralUnit, fitted = false): ScatterSeriesOption => ({
      id, name, type: 'scatter', yAxisIndex,
      silent: true,
      tooltip: { show: false },
      z: 5,
      symbol: 'circle',
      symbolSize: fitted ? 8 : 5,
      itemStyle: { color, borderColor: theme.background, borderWidth: 1 },
      label: {
        show: true,
        position: index % 2 ? 'bottom' : 'top',
        distance: 4,
        fontFamily: style.fontFamily,
        fontSize: Math.max(8, style.fontSize - 2),
        color,
        formatter: '{b}',
        textBorderColor: theme.background,
        textBorderWidth: 2,
      },
      labelLayout: { hideOverlap: true },
      data: points.map(({ x, y, label }) => ({ value: [x, y], name: label ?? spectrumPositionNumber(x, unit) })),
  });
  const labelOpt = style.showDataLabels
    ? {
        show: true,
        position: horizontal ? ('right' as const) : ('top' as const),
        fontSize: Math.max(8, style.fontSize - 1),
        fontFamily: style.fontFamily,
        color: theme.textColor,
        formatter: usePercent ? '{@[1]}%' : undefined,
      }
    : { show: false };

  resolved.forEach((s, i) => {
    const m = s.mapping;
    const dataset = datasets.find((item) => item.id === m.datasetId);
    const name = dataset && (nameCounts.get(s.name) ?? 0) > 1 ? `${s.name} · ${dataset.name}` : s.name;
    const color = colorByCurve.get(s.sid) ?? palette[0];
    const fillColor = hexOpacity(color, m.opacity);
    const yAxisIndex = m.y2 ? 1 : 0;
    const symbol = m.symbol || (style.showSymbols ? 'circle' : 'none');
    const unit = spectralSeriesUnit(chart, dataset?.columns[m.xCol]);

    const catValue = (p: XYPoint | undefined): number | null => {
      if (!p) return null;
      if (!usePercent) return p.y;
      const t = totals.get(String(p.x)) ?? 0;
      return t === 0 ? 0 : +((p.y / t) * 100).toFixed(2);
    };

    let data: (number | null)[] | number[][];
    let points: MeasurementSeries['points'];
    if (categories) {
      const categoryPoints = new Map<string, XYPoint>();
      for (const point of s.points) {
        const key = String(point.x);
        if (!categoryPoints.has(key)) categoryPoints.set(key, point);
      }
      const values = categories.map((category) => catValue(categoryPoints.get(category)));
      data = values;
      points = function* () {
        for (const [dataIndex, category] of categories.entries()) {
          const point = categoryPoints.get(category);
          const value = values[dataIndex];
          if (!point || value === null) continue;
          yield { x: horizontal ? value : category, y: horizontal ? category : value, row: point.ri, dataIndex };
        }
      };
    } else {
      const values = xyData(s, chart.type === 'scatter', Boolean(chart.spectralAxis));
      data = values;
      points = function* () {
        for (const [dataIndex, [x, y, row]] of values.entries()) yield { x, y, row, dataIndex };
      };
    }
    measurementAxes.set(series.length, horizontal ? 0 : yAxisIndex);
    fitLabels.measurements?.push({ index: series.length, name, datasetId: m.datasetId, points });

    if (isBar) {
      series.push({
        type: 'bar',
        name,
        data,
        yAxisIndex: horizontal ? undefined : yAxisIndex,
        stack: style.stack ? 'total' : undefined,
        barGap: `${style.barGap}%`,
        itemStyle: {
          color: fillColor,
          borderRadius: style.barBorderRadius
            ? horizontal
              ? [0, style.barBorderRadius, style.barBorderRadius, 0]
              : [style.barBorderRadius, style.barBorderRadius, 0, 0]
            : 0,
        },
        label: labelOpt,
      });
    } else if (chart.type === 'scatter') {
      const hasSize = s.points.some((p) => p.size !== undefined);
      const sizes = s.points.map((p) => p.size ?? 0);
      const [smin, smax] = extent(sizes);
      series.push({
        id: s.sid,
        type: 'scatter',
        name,
        data,
        yAxisIndex,
        symbol: symbol === 'none' ? 'circle' : symbol,
        symbolSize: hasSize
          ? (v: number[]) => {
              const t = smax === smin ? 0.5 : (v[3] - smin) / (smax - smin);
              return style.symbolSize * (0.6 + t * 2.2);
            }
          : style.symbolSize,
        itemStyle: { color: fillColor },
        label: labelOpt,
      });
    } else {
      series.push({
        id: s.sid,
        type: 'line',
        name,
        data,
        yAxisIndex,
        smooth: style.smooth && !style.step,
        step: style.step ? ('middle' as const) : undefined,
        symbol,
        symbolSize: style.symbolSize,
        lineStyle: { width: style.lineWidth, color, type: LINE_TYPE[m.lineStyle] },
        itemStyle: { color },
        areaStyle:
          chart.type === 'area' ? { opacity: 0.25 * m.opacity, color } : undefined,
        stack: chart.type === 'area' && style.stack ? 'total' : undefined,
        label: labelOpt,
        connectNulls: true,
      });
    }

    if (chart.showPeakPositions && !categoryX && !isBar) {
      const peaks = spectrumPeaks(chart, s);
      if (peaks.length) series.push(peakMarkers(`observed-peaks:${s.sid}`, name, peaks, color, yAxisIndex, i, unit));
    }

    const curveFits = categoryX || isBar ? [] : spectra.filter((config) => isSpectrumTarget(config, s));
    for (const spectrum of curveFits) {
      const result = fitLabels.fitResults ? fitLabels.fitResults.spectrum(s, spectrum) : calculateSpectrum(chart, s, spectrum);
      if (!result || 'error' in result) continue;
      const nextColor = () => {
        const selected = chooseFitColor(color, rawColors, usedFitColors, theme.id === 'dark');
        usedFitColors.add(selected);
        return selected;
      };
      const key = `${spectrum.shape}:${s.sid}`;
      const totalColor = nextColor();
      const modelName = fitLabels.spectrum?.total(spectrum.shape) ?? `${spectrum.shape} fit`;
      const totalName = multipleSpectralCurves ? `${name} · ${modelName}` : modelName;
      const totalId = `spectral-total:${key}`;
      series.push({
        id: totalId, type: 'line', name: totalName,
        data: result.total, yAxisIndex, symbol: 'none', silent: true, tooltip: { show: false },
        lineStyle: { color: totalColor, width: style.lineWidth + 0.6 },
        itemStyle: { color: totalColor }, z: 4,
      });
      if (result.residuals.length) fitLabels.residuals?.push({
        id: totalId, name: totalName, color: totalColor, rightAxis: m.y2, points: result.residuals,
      });
      if (!showComponents) continue;
      const componentAxis = m.y2 ? chart.y2Axis : chart.yAxis;
      const { min, max } = axisBounds(componentAxis);
      const showZero = componentAxis.scale !== 'log' && (min === undefined || min <= 0) && (max === undefined || max >= 0);
      const inFitRange = (x: number) => x >= result.total[0][0] && x <= result.total[result.total.length - 1][0];
      result.peaks.forEach(({ center, height, points, shift }, index) => {
        const componentColor = nextColor();
        const peakName = fitLabels.spectrum?.peak(index + 1) ?? `Peak ${index + 1}`;
        const componentName = spectra.length > 1 ? `${totalName} · ${peakName}` : peakName;
        series.push({
          id: `spectral-peak:${key}:${index}`, type: 'line',
          name: componentName, data: points, yAxisIndex, symbol: 'none', silent: true, tooltip: { show: false },
          lineStyle: { color: componentColor, type: 'dashed', width: style.lineWidth },
          itemStyle: { color: componentColor }, z: 3,
        });
        if (height > 0 && Number.isFinite(height) && inFitRange(center)) {
          const label = spectrum.shape === 'logNormal' ? `x_c = ${spectrumPositionNumber(center, unit)}` : undefined;
          series.push(peakMarkers(`spectral-center:${key}:${index}`, componentName,
            [{ x: center, y: height, label }], componentColor, yAxisIndex, index + 1, unit, true));
        }
        if (shift !== undefined && showZero && inFitRange(shift)) {
          const marker = peakMarkers(`spectral-shift:${key}:${index}`, componentName,
            [{ x: shift, y: 0, label: `x₀ = ${spectrumPositionNumber(shift, unit)}` }], componentColor, yAxisIndex, 0, unit);
          series.push(marker);
        }
      });
    }

    // ---- error display: bars or shaded band ----
    if (!horizontal) {
      const withErr = s.points.filter((p) => p.err !== undefined);
      if (withErr.length > 0) {
        if (m.errorDisplay === 'band' && !categoryX && !isBar) {
          const sorted = [...withErr].sort((a, b) => (a.x as number) - (b.x as number));
          series.push(
            {
              type: 'line',
              name: `__band_lo_${s.sid}`,
              data: sorted.map((p) => [p.x as number, p.y - p.err!]),
              symbol: 'none',
              lineStyle: { width: 0 },
              stack: `__band_${s.sid}`,
              silent: true,
              tooltip: { show: false },
              z: 1,
            } as SeriesOption,
            {
              type: 'line',
              name: `__band_hi_${s.sid}`,
              data: sorted.map((p) => [p.x as number, 2 * p.err!]),
              symbol: 'none',
              lineStyle: { width: 0 },
              areaStyle: { color, opacity: 0.18 },
              stack: `__band_${s.sid}`,
              silent: true,
              tooltip: { show: false },
              z: 1,
            } as SeriesOption,
          );
        } else {
          const errData: [number | string, number, number][] = withErr.map((p) => [
            categoryX ? String(p.x) : (p.x as number),
            p.y - p.err!,
            p.y + p.err!,
          ]);
          series.push(errorBarSeries(errData, color, yAxisIndex, categoryX, style.lineWidth));
        }
      }
    }

    const methods = supportsTrendline(chart.type) && !categoryX ? selectedTrendlines(m) : [];
    for (const kind of methods) {
      const trend = fitLabels.fitResults ? fitLabels.fitResults.trendline(s, kind) : calculateTrendline(chart, s, kind);
      if (!trend?.points.length) continue;
      const quality = trend.fit?.r2 == null ? undefined : `R²=${trend.fit.r2.toFixed(3)}`;
      const fitColor = chooseFitColor(color, rawColors, usedFitColors, theme.id === 'dark');
      usedFitColors.add(fitColor);
      const modelName = methods.length > 1 ? ` · ${fitLabels.model?.(kind) ?? kind}` : '';
      const fitName = `${name}${modelName} · ${quality ?? (trend.fit ? 'Fit' : 'MA')}`;
      if (trend.residuals.length) fitLabels.residuals?.push({
        id: `trend:${s.sid}:${kind}`, name: fitName, color: fitColor, rightAxis: m.y2, points: trend.residuals,
      });
      const annotation = trend.fit ? fitAnnotation(trend.fit, kind === 'linear') : (fitLabels.movingAverage ?? 'Moving average');
      const fontSize = Math.max(8, style.fontSize - 1);
      const labelLimit = Math.min(195, Math.max(64, (fitLabels.size?.().width ?? 454) * 0.56));
      const needsWrapping = annotation.split('\n').some((row) =>
        format.getTextRect(row, `${fontSize}px ${style.fontFamily}`).width > labelLimit);
      const leftInset = chart.yAxis.label ? 62 : 42;
      series.push({
        id: `trend:${s.sid}:${kind}`,
        type: 'line',
        name: fitName,
        data: trend.points,
        connectNulls: false,
        yAxisIndex,
        symbol: 'none',
        smooth: kind === 'movingAverage',
        lineStyle: { width: style.lineWidth, color: fitColor, type: 'dashed' },
        itemStyle: { color: fitColor },
        silent: true,
        tooltip: { show: false },
        z: 4,
        endLabel: {
          show: true,
          formatter: () => annotation,
          align: 'right',
          verticalAlign: 'bottom',
          distance: -8,
          fontSize,
          fontFamily: style.fontFamily,
          color: fitColor,
          lineHeight: fontSize + 4,
          width: needsWrapping ? labelLimit : undefined,
          overflow: needsWrapping ? 'break' : undefined,
          backgroundColor: hexOpacity(theme.background, 0.94),
          borderColor: hexOpacity(fitColor, 0.35),
          borderWidth: 1,
          borderRadius: 3,
          padding: [3, 5],
        },
        labelLayout: ({ labelRect }) => {
          const bounds = fitLabels.size?.();
          if (!bounds) return { moveOverlap: 'shiftY' };
          const left = Math.min(leftInset, Math.max(6, bounds.width - labelRect.width - 6));
          const right = bounds.width - labelRect.width - 6;
          const pastEndpoint = labelRect.x + labelRect.width + 16;
          const x = Math.max(left, pastEndpoint <= right ? pastEndpoint : Math.min(right, labelRect.x));
          const y = Math.max(fitLabels.gridTop + 3,
            Math.min(bounds.height - fitLabels.gridBottom - labelRect.height - 3, labelRect.y));
          return { dx: x - labelRect.x, dy: y - labelRect.y, moveOverlap: 'shiftY' };
        },
      } as SeriesOption);
    }
  });

  const valueAxisConfig = (axis: AxisConfig, right: boolean) => {
    const mappings = visible.map(({ mapping }) => mapping).filter((item) => Boolean(item.y2) === right);
    const normalized = supportsTrendline(chart.type) && mappings.length > 0 &&
      mappings.every((item) => item.normalization && item.normalization !== 'none');
    if (axis.label || !mappings.length) return axis;
    if (normalized) return { ...axis, label: normalizedAxisLabel };
    if (chart.spectralAxis?.density && supportsTrendline(chart.type)) {
      const unit = spectralOutputUnit(chart.spectralAxis.direction);
      return { ...axis, label: fitLabels.spectralDensity?.(unit) ?? `Intensity density (/${unit})` };
    }
    return axis;
  };
  const primaryAxis = valueAxisConfig(chart.yAxis, false);
  const buildValueAxis = (axis: AxisConfig) => {
    const option = axisOption(axis, chart, theme, false);
    if (chart.spectralAxis?.density && supportsTrendline(chart.type) && axis.tickFormat === 'auto') {
      option.axisLabel.formatter = (value: number) => {
        const magnitude = Math.abs(value);
        return magnitude >= 10000 || (magnitude > 0 && magnitude < 0.01)
          ? value.toExponential(2).replace(/\.?0+e/, 'e').replace('e+', 'e') : fitNumber(value, 5);
      };
    }
    return option;
  };
  const valueAxis = [buildValueAxis(primaryAxis)];
  if (chart.series.some((s) => s.y2) && !horizontal) {
    valueAxis.push({
      ...buildValueAxis(valueAxisConfig(chart.y2Axis, true)),
      splitLine: { show: false, lineStyle: { color: theme.gridColor, type: theme.gridType } },
    });
  }
  if (usePercent) {
    valueAxis[0] = {
      ...valueAxis[0],
      max: 100 as never,
      axisLabel: { ...valueAxis[0].axisLabel, formatter: (v: number) => `${v}%` },
    } as never;
  }

  const catAxis = categoryX ? axisOption(chart.xAxis, chart, theme, true, categories) : numericXAxisOption(chart, theme);
  if (chart.spectralAxis && !categoryX && chart.xAxis.tickFormat === 'auto') {
    catAxis.axisLabel = { ...catAxis.axisLabel, formatter: (value: number) => fitNumber(value, 5) };
  }

  const coordinate = (axis: string, label: string, value: string | number) => {
    const title = label ? `${axis} · ${format.encodeHTML(label)}` : axis;
    const text = typeof value === 'number' ? `${fitNumber(value, 10)}${usePercent ? '%' : ''}` : format.encodeHTML(value);
    return `${title} = ${text}`;
  };
  const pointTooltip = (params: TooltipComponentFormatterCallbackParams) => (Array.isArray(params) ? params : [params])
    .flatMap(({ seriesIndex, seriesName, name, value }) => {
      const axisIndex = measurementAxes.get(seriesIndex ?? -1);
      if (axisIndex === undefined) return [];
      const [domain, response] = categoryX ? [name, value] : Array.isArray(value) ? value : [];
      if ((typeof domain !== 'number' && typeof domain !== 'string') ||
          typeof response !== 'number' || !Number.isFinite(response)) return [];
      const valueLabel = valueAxis[axisIndex]?.name ?? '';
      const x = horizontal ? coordinate('X', valueLabel, response) : coordinate('X', chart.xAxis.label, domain);
      const y = horizontal ? coordinate('Y', chart.xAxis.label, domain) : coordinate('Y', valueLabel, response);
      return [[format.encodeHTML(seriesName ?? ''), x, y].join('<br>')];
    }).join('<br><br>');

  return {
    ...base,
    grid: !horizontal && primaryAxis.label ? { ...base.grid, left: 40 } : base.grid,
    legend,
    xAxis: (horizontal ? valueAxis[0] : catAxis) as never,
    yAxis: (horizontal ? catAxis : valueAxis) as never,
    series,
    tooltip: {
      trigger: categoryX || chart.type !== 'scatter' ? 'axis' : 'item',
      confine: true,
      renderMode: 'html',
      formatter: pointTooltip,
      axisPointer: { type: isBar ? 'shadow' : 'line', snap: !categoryX },
    },
  };
}

function errorBarSeries(
  data: [number | string, number, number][],
  color: string,
  yAxisIndex: number,
  onCategory: boolean,
  lineWidth: number,
): SeriesOption {
  return {
    type: 'custom',
    name: '__err__',
    silent: true,
    tooltip: { show: false },
    yAxisIndex,
    z: 5,
    renderItem: (_params: unknown, api: RenderApi) => {
      const lo = api.coord([api.value(0), api.value(1)]);
      const hi = api.coord([api.value(0), api.value(2)]);
      const halfW = onCategory ? Math.min(8, api.size([1, 0])[0] * 0.12) : 5;
      const style = { stroke: color, fill: undefined as undefined, lineWidth: Math.max(1, lineWidth * 0.8) };
      return {
        type: 'group',
        children: [
          { type: 'line', shape: { x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] }, style },
          { type: 'line', shape: { x1: lo[0] - halfW, y1: lo[1], x2: lo[0] + halfW, y2: lo[1] }, style },
          { type: 'line', shape: { x1: hi[0] - halfW, y1: hi[1], x2: hi[0] + halfW, y2: hi[1] }, style },
        ],
      };
    },
    data,
  } as SeriesOption;
}
