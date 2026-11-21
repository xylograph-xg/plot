import { create } from 'zustand';
import { temporal } from 'zundo';
import type {
  Annotation,
  AxisConfig,
  CellValue,
  ChartConfig,
  ChartType,
  Dataset,
  FigureLayout,
  FigureView,
  ProjectFile,
  RowFilter,
  SeriesMapping,
  ToolId,
} from '../types';
import { numericColumnIndices, uid } from '../lib/parse';
import { scanRowFilter, validPlateauPoints } from '../lib/autoStart';
import { columnsForTemplate, makeChartTemplate, readChartTemplate, writeChartTemplate, type ChartTemplate } from '../lib/chartTemplate';
import { namedColumn, rebindSeries } from '../lib/seriesDataset';
import { chartSources } from '../lib/chartSources';
import { supportsTrendline } from '../lib/xySeries';
import { activeSpectrumFits } from '../lib/spectrum';
import { spectralAxisPatch } from '../lib/spectralAxis';

export type AppMode = 'chart' | 'canvas';

function defaultAxis(label = ''): AxisConfig {
  return {
    label,
    scale: 'linear',
    min: '',
    max: '',
    tickInside: false,
    showGrid: false,
    labelRotate: 0,
    tickFormat: 'auto',
  };
}

export function defaultChart(): ChartConfig {
  return {
    id: uid('chart'),
    type: 'scatter',
    title: '',
    subtitle: '',
    series: [],
    xAxis: defaultAxis(),
    yAxis: defaultAxis(),
    y2Axis: defaultAxis(),
    style: {
      theme: 'publication',
      fontFamily: 'Arial',
      fontSize: 11,
      titleSize: 14,
      lineWidth: 1.5,
      symbolSize: 6,
      showSymbols: true,
      smooth: false,
      step: false,
      palette: 'okabe-ito',
      showLegend: true,
      legendPosition: 'top',
      barGap: 10,
      stack: false,
      percentStack: false,
      barBorderRadius: 0,
      histogramBins: 20,
      pieDonut: 0,
      pieShowLabels: true,
      showDataLabels: false,
      boxShowPoints: false,
    },
  };
}

export function defaultSeries(datasetId: string): SeriesMapping {
  return {
    id: uid('ser'),
    datasetId,
    name: '',
    xCol: 0,
    yCol: 1,
    errCol: -1,
    groupCol: -1,
    sizeCol: -1,
    y2: false,
    color: '',
    lineStyle: 'solid',
    symbol: '',
    opacity: 1,
    trendline: 'linear',
    errorDisplay: 'bars',
  };
}

function presetChart(template: ChartTemplate | null): ChartConfig {
  return { ...defaultChart(), ...template?.chart };
}

function initialSeries(dataset: Dataset, template: ChartTemplate | null): SeriesMapping[] {
  const numeric = numericColumnIndices(dataset);
  const xCol = numeric.length > 1 ? numeric[0] : dataset.columns.length > 1 ? 0 : -1;
  const yCol = numeric.find((column) => column !== xCol) ?? numeric[0] ?? 0;
  const fallback = { ...defaultSeries(dataset.id), xCol, yCol };
  if (!template?.series.length) return [fallback];
  return template.series.map((mapping, index) => ({
    ...fallback,
    ...columnsForTemplate(mapping, template, dataset, fallback),
    id: index === 0 ? fallback.id : uid('ser'),
  }));
}

function withoutAutoStart(filter: RowFilter): RowFilter | undefined {
  return filter.last !== undefined || filter.condition ? { last: filter.last, condition: filter.condition } : undefined;
}

function layoutForCharts(layout: FigureLayout, length: number): FigureLayout {
  const cols = length > 1 ? 2 : 1;
  return { ...layout, cols, rows: Math.ceil(length / cols) };
}

function fileSelection(state: State, dataset: Dataset, charts: ChartConfig[]): Partial<State> {
  const linked = charts.find((chart) => chart.fileDatasetId === dataset.id) ?? charts.find((chart) =>
    chart.fileDatasetId === undefined && chart.series.length && chart.series.every((series) => series.datasetId === dataset.id));
  const active = charts.find((chart) => chart.id === state.activeChartId);
  const available = active && !active.series.length && !active.fileDatasetId ? active : undefined;
  const chart = linked ? { ...linked, fileDatasetId: dataset.id } : {
    ...(available ?? presetChart(state.defaultTemplate)),
    fileDatasetId: dataset.id,
    title: available?.title || dataset.name,
    series: initialSeries(dataset, state.defaultTemplate),
  };
  const picked = linked ?? available;
  const next = linked?.fileDatasetId === dataset.id ? charts : picked
    ? charts.map((item) => item.id === picked.id ? chart : item) : [...charts, chart];
  return {
    charts: next,
    activeChartId: chart.id,
    activeDatasetId: dataset.id,
    figureView: 'single',
    selectedAnnotationId: null,
    layout: next.length === charts.length ? state.layout : layoutForCharts(state.layout, next.length),
  };
}

/** Fill in fields added in v2 so old project files / charts keep working. */
export function migrateChart(c: Partial<ChartConfig>): ChartConfig {
  const fresh = defaultChart();
  const migrateAxis = (a?: Partial<AxisConfig>): AxisConfig => ({
    ...defaultAxis(),
    ...(a ?? {}),
  });
  return {
    ...fresh,
    type: 'line',
    ...c,
    id: c.id ?? fresh.id,
    subtitle: c.subtitle ?? '',
    xAxis: migrateAxis(c.xAxis),
    yAxis: migrateAxis(c.yAxis),
    y2Axis: migrateAxis(c.y2Axis),
    style: { ...fresh.style, ...(c.style ?? {}) },
    spectrumFit: undefined,
    spectrumFits: activeSpectrumFits(c),
    series: (c.series ?? []).map((m) => ({
      ...defaultSeries(m.datasetId ?? ''),
      ...m,
      trendline: m.trendline ?? 'none',
    })),
  };
}

interface State {
  datasets: Dataset[];
  charts: ChartConfig[];
  layout: FigureLayout;
  activeChartId: string;
  figureView: FigureView;
  annotations: Annotation[];
  canvasAnnotations: Annotation[];
  selectedAnnotationId: string | null;
  tool: ToolId;
  editPoints: boolean;
  mode: AppMode;
  figureWidthMm: number;
  figureHeightMm: number;
  exportDpi: number;
  activeDatasetId: string | null;
  defaultTemplate: ChartTemplate | null;
  autoScanIssue: { datasetId: string; issue: 'notFound' | 'beyondEnd' | 'missingColumn' } | null;

  // dataset actions
  openLocalDataset: (data: Dataset) => void;
  focusLocalDataset: (datasetId: string) => void;
  removeDataset: (id: string) => void;
  renameDataset: (id: string, name: string) => void;
  setActiveDataset: (id: string | null) => void;
  setRowFilter: (dsId: string, rowFilter?: RowFilter) => void;
  updateCell: (dsId: string, row: number, col: number, value: CellValue) => void;
  updateColumnName: (dsId: string, col: number, name: string) => void;
  addRow: (dsId: string) => void;
  addColumn: (dsId: string) => void;
  deleteRow: (dsId: string, row: number) => void;
  deleteColumn: (dsId: string, col: number) => void;
  sortByColumn: (dsId: string, col: number, asc: boolean) => void;

  // chart actions
  saveDefaultTemplate: (chartId: string, scan: Pick<ChartTemplate, 'scanOnImport' | 'plateauPoints' | 'scanMode' | 'scanColumn'>) => boolean;
  clearDefaultTemplate: () => boolean;
  setActiveChart: (id: string, view?: FigureView) => void;
  setFigureView: (view: FigureView) => void;
  mergeCharts: (ids: string[], title: string) => boolean;
  addChart: () => void;
  duplicateChart: (id: string) => void;
  removeChart: (id: string) => void;
  updateChart: (id: string, patch: Partial<ChartConfig>, filters?: ReadonlyMap<string, RowFilter>) => void;
  setChartType: (id: string, type: ChartType) => void;
  addSeries: (chartId: string) => void;
  updateSeries: (chartId: string, seriesId: string, patch: Partial<SeriesMapping>) => void;
  removeSeries: (chartId: string, seriesId: string) => void;
  duplicateSeries: (chartId: string, seriesId: string) => void;
  setLayout: (patch: Partial<FigureLayout>) => void;

  // annotation actions
  addAnnotation: (a: Annotation) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  clearAnnotations: () => void;
  selectAnnotation: (id: string | null) => void;
  setTool: (t: ToolId) => void;
  setEditPoints: (v: boolean) => void;

  // app
  setMode: (m: AppMode) => void;
  setFigureSize: (w: number, h: number) => void;
  setExportDpi: (dpi: number) => void;
  loadProject: (p: ProjectFile) => void;
  serializeProject: () => ProjectFile;
}

const savedTemplate = readChartTemplate();
const firstChart = presetChart(savedTemplate);

const emptyAnnotations: Annotation[] = [];

export function currentAnnotations(state: State): Annotation[] {
  if (state.mode === 'canvas') return state.canvasAnnotations;
  if (state.figureView === 'layout') return state.annotations;
  const chart = state.charts.find((item) => item.id === state.activeChartId);
  return chart?.annotations ?? (state.charts.length === 1 ? state.annotations : emptyAnnotations);
}

function annotationPatch(state: State, annotations: Annotation[]): Partial<State> {
  if (state.mode === 'canvas') return { canvasAnnotations: annotations };
  if (state.figureView === 'layout') return { annotations };
  return { charts: state.charts.map((item) => item.id === state.activeChartId ? { ...item, annotations } : item) };
}

export const useStore = create<State>()(
  temporal(
    (set, get) => ({
      datasets: [],
      charts: [firstChart],
      layout: { rows: 1, cols: 1, showPanelLabels: true },
      activeChartId: firstChart.id,
      figureView: 'single',
      annotations: [],
      canvasAnnotations: [],
      selectedAnnotationId: null,
      tool: 'select',
      editPoints: false,
      mode: 'chart',
      figureWidthMm: 120,
      figureHeightMm: 90,
      exportDpi: 300,
      activeDatasetId: null,
      defaultTemplate: savedTemplate,
      autoScanIssue: null,

      saveDefaultTemplate: (chartId, scan) => {
        const { charts, datasets } = get();
        const chart = charts.find((item) => item.id === chartId);
        if (!chart || !validPlateauPoints(scan.plateauPoints)) return false;
        const defaultTemplate = makeChartTemplate(chart, datasets, scan);
        if (!writeChartTemplate(defaultTemplate)) return false;
        set({ defaultTemplate });
        return true;
      },
      clearDefaultTemplate: () => {
        if (!writeChartTemplate(null)) return false;
        set({ defaultTemplate: null });
        return true;
      },

      openLocalDataset: (data) =>
        set((state) => {
          const stored = state.datasets.find((dataset) => dataset.id === data.id);
          const sameSchema = stored?.columns.length === data.columns.length &&
            data.columns.every((column, index) => column === stored.columns[index]);
          const dataset: Dataset = { ...data, rowFilter: sameSchema ? stored?.rowFilter : undefined };
          const { defaultTemplate } = state;
          const previousScan = dataset.rowFilter?.autoStart;
          const autoImport = !stored && defaultTemplate?.scanOnImport ? defaultTemplate : undefined;
          const templateSignal = autoImport?.scanColumn ?? autoImport?.columns[autoImport.series[0]?.yCol];
          const signalColumn = !autoImport ? undefined : templateSignal === undefined
            ? initialSeries(dataset, defaultTemplate)[0].yCol : namedColumn(dataset.columns, templateSignal);
          const autoScan = previousScan ?? (autoImport && signalColumn !== undefined
            ? { column: signalColumn, plateauPoints: autoImport.plateauPoints, mode: autoImport.scanMode } : undefined);
          const scan = autoScan ? scanRowFilter(dataset, autoScan) : autoImport ? 'missingColumn' : undefined;
          if (scan && typeof scan !== 'string') dataset.rowFilter = scan;
          else if (dataset.rowFilter?.autoStart) dataset.rowFilter = withoutAutoStart(dataset.rowFilter);
          const charts = !stored || sameSchema ? state.charts : state.charts.map((chart) => {
            if (!chart.series.some((mapping) => mapping.datasetId === data.id)) return chart;
            return { ...chart, series: chart.series.map((mapping) =>
              mapping.datasetId === data.id ? rebindSeries(mapping, stored, dataset) : mapping) };
          });
          return {
            ...fileSelection(state, dataset, charts),
            datasets: stored
              ? state.datasets.map((old) => old.id === dataset.id ? dataset : old)
              : [...state.datasets, dataset],
            autoScanIssue: typeof scan === 'string' ? { datasetId: dataset.id, issue: scan } : null,
          };
        }),
      focusLocalDataset: (datasetId) =>
        set((state) => {
          const dataset = state.datasets.find((item) => item.id === datasetId);
          return dataset ? fileSelection(state, dataset, state.charts) : state;
        }),
      removeDataset: (id) =>
        set((s) => ({
          datasets: s.datasets.filter((d) => d.id !== id),
          activeDatasetId: s.activeDatasetId === id ? null : s.activeDatasetId,
          charts: s.charts.map((c) => ({
            ...c,
            fileDatasetId: c.fileDatasetId === id ? null : c.fileDatasetId,
            series: c.series.filter((m) => m.datasetId !== id),
            spectrumFit: undefined,
            spectrumFits: activeSpectrumFits(c).filter((fit) =>
              !c.series.some((mapping) => mapping.id === fit.seriesId && mapping.datasetId === id)),
          })),
        })),
      renameDataset: (id, name) =>
        set((s) => ({ datasets: s.datasets.map((d) => (d.id === id ? { ...d, name } : d)) })),
      setActiveDataset: (id) => set({ activeDatasetId: id }),
      setRowFilter: (dsId, rowFilter) =>
        set((s) => ({
          datasets: s.datasets.map((d) => d.id === dsId ? { ...d, rowFilter } : d),
          autoScanIssue: dsId === s.autoScanIssue?.datasetId ? null : s.autoScanIssue,
        })),
      updateCell: (dsId, row, col, value) =>
        set((s) => ({
          datasets: s.datasets.map((d) => {
            if (d.id !== dsId) return d;
            const rows = d.rows.map((r, ri) =>
              ri === row ? r.map((c, ci) => (ci === col ? value : c)) : r,
            );
            return { ...d, rows };
          }),
        })),
      updateColumnName: (dsId, col, name) =>
        set((s) => ({
          datasets: s.datasets.map((d) =>
            d.id === dsId
              ? { ...d, columns: d.columns.map((c, ci) => (ci === col ? name : c)) }
              : d,
          ),
        })),
      addRow: (dsId) =>
        set((s) => ({
          datasets: s.datasets.map((d) =>
            d.id === dsId ? { ...d, rows: [...d.rows, d.columns.map(() => null)] } : d,
          ),
        })),
      addColumn: (dsId) =>
        set((s) => ({
          datasets: s.datasets.map((d) =>
            d.id === dsId
              ? {
                  ...d,
                  columns: [...d.columns, `Col${d.columns.length + 1}`],
                  rows: d.rows.map((r) => [...r, null]),
                }
              : d,
          ),
        })),
      deleteRow: (dsId, row) =>
        set((s) => ({
          datasets: s.datasets.map((d) => {
            if (d.id !== dsId) return d;
            let rowFilter = d.rowFilter;
            if (rowFilter?.autoStart && rowFilter.first !== undefined) {
              if (row === rowFilter.first - 1) rowFilter = withoutAutoStart(rowFilter);
              else if (row < rowFilter.first - 1) rowFilter = { ...rowFilter, first: rowFilter.first - 1 };
            }
            return { ...d, rowFilter, rows: d.rows.filter((_, ri) => ri !== row) };
          }),
        })),
      deleteColumn: (dsId, col) =>
        set((s) => ({
          datasets: s.datasets.map((d) => {
            if (d.id !== dsId || d.columns.length <= 1) return d;
            const { condition, autoStart } = d.rowFilter ?? {};
            const remap = (index: number) => index > col ? index - 1 : index;
            const rowFilter = d.rowFilter
              ? {
                  ...d.rowFilter,
                  condition: condition && condition.column !== col ? { ...condition, column: remap(condition.column) } : undefined,
                  autoStart: autoStart && autoStart.column !== col ? { ...autoStart, column: remap(autoStart.column) } : undefined,
                }
              : d.rowFilter;
            return {
              ...d,
              rowFilter,
              textColumns: d.textColumns?.filter((index) => index !== col).map(remap),
              columns: d.columns.filter((_, ci) => ci !== col),
              rows: d.rows.map((r) => r.filter((_, ci) => ci !== col)),
            };
          }),
          // fix series column references pointing at/after the removed column
          charts: s.charts.map((c) => ({
            ...c,
            series: c.series.map((m) => {
              if (m.datasetId !== dsId) return m;
              const fix = (v: number) => (v === col ? 0 : v > col ? v - 1 : v);
              const fixOpt = (v: number) => (v === col ? -1 : v > col ? v - 1 : v);
              return {
                ...m,
                xCol: fix(m.xCol),
                yCol: fix(m.yCol),
                errCol: fixOpt(m.errCol),
                groupCol: fixOpt(m.groupCol),
                sizeCol: fixOpt(m.sizeCol),
              };
            }),
          })),
        })),
      sortByColumn: (dsId, col, asc) =>
        set((s) => ({
          datasets: s.datasets.map((d) => {
            if (d.id !== dsId) return d;
            const rows = [...d.rows].sort((a, b) => {
              const va = a[col];
              const vb = b[col];
              if (va === null) return 1;
              if (vb === null) return -1;
              const cmp =
                typeof va === 'number' && typeof vb === 'number'
                  ? va - vb
                  : String(va).localeCompare(String(vb));
              return asc ? cmp : -cmp;
            });
            return { ...d, rows, rowFilter: d.rowFilter?.autoStart ? withoutAutoStart(d.rowFilter) : d.rowFilter };
          }),
        })),

      setActiveChart: (id, view) => set((state) => {
        const chart = state.charts.find((item) => item.id === id);
        if (!chart) return state;
        const sources = chartSources(chart, state.datasets);
        const dataset = sources.find((item) => item.id === state.activeDatasetId) ?? sources[0];
        return {
          activeChartId: id,
          activeDatasetId: dataset?.id ?? state.activeDatasetId,
          figureView: view ?? state.figureView,
          selectedAnnotationId: id === state.activeChartId && !view ? state.selectedAnnotationId : null,
        };
      }),
      setFigureView: (figureView) => set({ figureView, selectedAnnotationId: null }),
      mergeCharts: (ids, title) => {
        const state = get();
        const selected = [...new Set(ids)].flatMap((id) => {
          const chart = state.charts.find((item) => item.id === id);
          return chart && supportsTrendline(chart.type) && chartSources(chart, state.datasets).length ? [chart] : [];
        });
        if (selected.length < 2) return false;
        const first = selected[0];
        const sameConversion = selected.every(({ spectralAxis }) =>
          spectralAxis?.direction === first.spectralAxis?.direction && spectralAxis?.density === first.spectralAxis?.density);
        const axes = sameConversion ? selected : selected.map((chart) => ({ ...chart, ...spectralAxisPatch(chart) }));
        const axis = (key: 'xAxis' | 'yAxis') => ({
          ...axes[0][key],
          label: axes.every((chart) => chart[key].label === axes[0][key].label) ? axes[0][key].label : '',
          scale: axes.every((chart) => chart[key].scale === axes[0][key].scale) ? axes[0][key].scale : 'linear' as const,
          min: '', max: '',
        });
        const series = selected.flatMap((source) => {
          const prefix = source.title.trim() || chartSources(source, state.datasets)[0]?.name || '';
          return source.series.flatMap((mapping) => {
            const dataset = state.datasets.find((item) => item.id === mapping.datasetId);
            if (!dataset) return [];
            const name = mapping.name || dataset.columns[mapping.yCol] || dataset.name;
            return [{ ...mapping, id: uid('ser'), color: '', y2: false,
              name: source.series.length > 1 && prefix !== name ? `${prefix} · ${name}` : (prefix || name) }];
          });
        });
        const usedNames = new Set<string>();
        for (const mapping of series) {
          const base = mapping.name;
          for (let count = 2; usedNames.has(mapping.name); count += 1) mapping.name = `${base} (${count})`;
          usedNames.add(mapping.name);
        }
        const chart: ChartConfig = {
          ...axes[0], id: uid('chart'), fileDatasetId: null, title, subtitle: '', series, annotations: [],
          spectrumFit: undefined, spectrumFits: [],
          type: selected.every((item) => item.type === first.type) ? first.type : 'line',
          xAxis: axis('xAxis'), yAxis: axis('yAxis'),
          style: { ...first.style, stack: false, showLegend: true },
        };
        set({
          charts: [...state.charts, chart], activeChartId: chart.id, activeDatasetId: series[0]?.datasetId ?? null,
          figureView: 'single', selectedAnnotationId: null, layout: layoutForCharts(state.layout, state.charts.length + 1),
        });
        return true;
      },
      addChart: () =>
        set((s) => {
          const c = presetChart(s.defaultTemplate);
          return {
            charts: [...s.charts, c],
            activeChartId: c.id,
            selectedAnnotationId: null,
            layout: layoutForCharts(s.layout, s.charts.length + 1),
          };
        }),
      duplicateChart: (id) =>
        set((s) => {
          const src = s.charts.find((c) => c.id === id);
          if (!src) return s;
          const copy: ChartConfig = JSON.parse(JSON.stringify(src));
          copy.id = uid('chart');
          copy.fileDatasetId = null;
          const sourceIds = copy.series.map(({ id: seriesId }) => seriesId);
          copy.series = copy.series.map((m) => ({ ...m, id: uid('ser') }));
          copy.spectrumFits = activeSpectrumFits(copy).flatMap((fit) => {
            const mapping = copy.series[sourceIds.indexOf(fit.seriesId)];
            return mapping ? [{ ...fit, seriesId: mapping.id }] : [];
          });
          copy.spectrumFit = undefined;
          return {
            charts: [...s.charts, copy],
            activeChartId: copy.id,
            selectedAnnotationId: null,
            layout: layoutForCharts(s.layout, s.charts.length + 1),
          };
        }),
      removeChart: (id) =>
        set((s) => {
          if (s.charts.length <= 1) return s;
          const charts = s.charts.filter((c) => c.id !== id);
          const active = s.activeChartId === id ? charts[0] : charts.find((chart) => chart.id === s.activeChartId);
          return {
            charts,
            activeChartId: active?.id ?? charts[0].id,
            activeDatasetId: active && s.activeChartId === id ? chartSources(active, s.datasets)[0]?.id ?? null : s.activeDatasetId,
            selectedAnnotationId: s.activeChartId === id ? null : s.selectedAnnotationId,
            layout: layoutForCharts(s.layout, charts.length),
          };
        }),
      updateChart: (id, patch, filters) =>
        set((s) => ({
          charts: s.charts.map((c) => (c.id === id ? { ...c, ...patch } : c)),
          ...(filters?.size ? {
            datasets: s.datasets.map((dataset) => {
              const rowFilter = filters.get(dataset.id);
              return rowFilter ? { ...dataset, rowFilter } : dataset;
            }),
            autoScanIssue: s.autoScanIssue && filters.has(s.autoScanIssue.datasetId) ? null : s.autoScanIssue,
          } : {}),
        })),
      setChartType: (id, type) =>
        set((s) => ({ charts: s.charts.map((c) => c.id !== id ? c : {
          ...c, ...(supportsTrendline(type) ? {} : spectralAxisPatch(c)), type,
        }) })),
      addSeries: (chartId) =>
        set((s) => {
          const ds = s.datasets.find((d) => d.id === s.activeDatasetId) ?? s.datasets[0];
          if (!ds) return s;
          return {
            charts: s.charts.map((c) =>
              c.id === chartId ? { ...c, series: c.series.length
                ? [...c.series, { ...defaultSeries(ds.id), trendline: c.series[0].trendline, trendlines: c.series[0].trendlines,
                    normalization: c.series[0].normalization }] : initialSeries(ds, s.defaultTemplate) } : c,
            ),
          };
        }),
      updateSeries: (chartId, seriesId, patch) =>
        set((s) => ({
          charts: s.charts.map((c) => {
            if (c.id !== chartId) return c;
            const series = c.series.map((m) => (m.id === seriesId ? { ...m, ...patch } : m));
            const lostFile = c.fileDatasetId && !series.some((mapping) => mapping.datasetId === c.fileDatasetId);
            return { ...c, series, fileDatasetId: lostFile ? null : c.fileDatasetId };
          }),
        })),
      removeSeries: (chartId, seriesId) =>
        set((s) => ({
          charts: s.charts.map((c) => {
            if (c.id !== chartId) return c;
            const series = c.series.filter((m) => m.id !== seriesId);
            const lostFile = c.fileDatasetId && !series.some((mapping) => mapping.datasetId === c.fileDatasetId);
            return {
              ...c, series, fileDatasetId: lostFile ? null : c.fileDatasetId, spectrumFit: undefined,
              spectrumFits: activeSpectrumFits(c).filter((fit) => fit.seriesId !== seriesId),
            };
          }),
        })),
      duplicateSeries: (chartId, seriesId) =>
        set((s) => ({
          charts: s.charts.map((c) => {
            if (c.id !== chartId) return c;
            const src = c.series.find((m) => m.id === seriesId);
            if (!src) return c;
            return { ...c, series: [...c.series, { ...src, id: uid('ser') }] };
          }),
        })),
      setLayout: (patch) => set((s) => ({ layout: { ...s.layout, ...patch } })),

      addAnnotation: (a) =>
        set((s) => ({ ...annotationPatch(s, [...currentAnnotations(s), a]), selectedAnnotationId: a.id })),
      updateAnnotation: (id, patch) =>
        set((s) => annotationPatch(s, currentAnnotations(s).map((a) => a.id === id ? { ...a, ...patch } : a))),
      removeAnnotation: (id) =>
        set((s) => ({
          ...annotationPatch(s, currentAnnotations(s).filter((a) => a.id !== id)),
          selectedAnnotationId: s.selectedAnnotationId === id ? null : s.selectedAnnotationId,
        })),
      clearAnnotations: () =>
        set((s) => ({ ...annotationPatch(s, []), selectedAnnotationId: null })),
      selectAnnotation: (id) => set({ selectedAnnotationId: id }),
      setTool: (t) => set({ tool: t, editPoints: false }),
      setEditPoints: (v) => set({ editPoints: v, tool: 'select' }),

      setMode: (m) => set({ mode: m, selectedAnnotationId: null, tool: 'select' }),
      setFigureSize: (w, h) => set({ figureWidthMm: w, figureHeightMm: h }),
      setExportDpi: (dpi) => set({ exportDpi: dpi }),

      loadProject: (p) => {
        const charts = p.charts.length > 0 ? p.charts.map(migrateChart) : [presetChart(get().defaultTemplate)];
        const active = charts.find((item) => item.id === p.activeChartId) ?? charts[0];
        set({
          datasets: p.datasets,
          charts,
          layout: p.layout,
          annotations: p.annotations,
          canvasAnnotations: p.canvasAnnotations,
          figureWidthMm: p.figureWidthMm,
          figureHeightMm: p.figureHeightMm,
          activeChartId: active.id,
          figureView: p.figureView === 'single' || p.figureView === 'layout' ? p.figureView : 'layout',
          activeDatasetId: chartSources(active, p.datasets)[0]?.id ?? p.datasets[0]?.id ?? null,
          autoScanIssue: null,
          selectedAnnotationId: null,
        });
      },
      serializeProject: () => {
        const s = get();
        return {
          app: 'sciplot',
          version: 3,
          datasets: s.datasets,
          charts: s.charts,
          activeChartId: s.activeChartId,
          figureView: s.figureView,
          layout: s.layout,
          annotations: s.annotations,
          canvasAnnotations: s.canvasAnnotations,
          figureWidthMm: s.figureWidthMm,
          figureHeightMm: s.figureHeightMm,
        };
      },
    }),
    {
      limit: 100,
      // Navigation alone does not create history. Restoring a document also restores its active view.
      partialize: (state) => ({
        datasets: state.datasets,
        charts: state.charts,
        layout: state.layout,
        annotations: state.annotations,
        canvasAnnotations: state.canvasAnnotations,
        figureWidthMm: state.figureWidthMm,
        figureHeightMm: state.figureHeightMm,
        activeChartId: state.activeChartId,
        activeDatasetId: state.activeDatasetId,
        figureView: state.figureView,
      }),
      equality: (past, next) => {
        const equal = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
        return past.figureWidthMm === next.figureWidthMm && past.figureHeightMm === next.figureHeightMm &&
          equal(past.datasets, next.datasets) && equal(past.charts, next.charts) && equal(past.layout, next.layout) &&
          equal(past.annotations, next.annotations) && equal(past.canvasAnnotations, next.canvasAnnotations);
      },
    },
  ),
);

export const useTemporalStore = () => useStore.temporal;
