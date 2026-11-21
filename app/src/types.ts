export type CellValue = number | string | null;

export type FilterOperator = 'equals' | 'contains' | 'gte' | 'lte' | 'empty';

export type AutoStartMode = 'drop' | 'rise';
export interface AutoStartRule {
  column: number;
  plateauPoints: number;
  mode?: AutoStartMode;
}

export interface RowFilter {
  first?: number;
  last?: number;
  condition?: { column: number; operator: FilterOperator; value: string };
  autoStart?: AutoStartRule;
}

export interface DatasetSource {
  root: string;
  fileId: string;
  sheet?: string;
  firstRowHeader?: boolean;
}

export interface Dataset {
  id: string;
  name: string;
  columns: string[];
  rows: CellValue[][];
  textColumns?: number[];
  rowFilter?: RowFilter;
  source?: DatasetSource;
}

export type ChartType =
  | 'line'
  | 'scatter'
  | 'bar'
  | 'barh'
  | 'area'
  | 'pie'
  | 'box'
  | 'violin'
  | 'histogram'
  | 'density'
  | 'heatmap'
  | 'correlation'
  | 'radar'
  | 'polar';

export type LineStyleKind = 'solid' | 'dashed' | 'dotted';
export type SymbolKind = 'circle' | 'rect' | 'triangle' | 'diamond' | 'emptyCircle' | 'none';
export type FitModelKind =
  | 'linear' | 'quadratic' | 'cubic' | 'quartic' | 'quintic'
  | 'exponential' | 'exponentialGrowth' | 'exponentialDecay' | 'doubleExponential' | 'doubleExponentialDecay'
  | 'logarithmic' | 'power' | 'squareRoot' | 'reciprocal'
  | 'gaussian' | 'lorentzian' | 'logistic' | 'hill' | 'sinusoidal';
export type TrendlineKind = 'none' | 'movingAverage' | FitModelKind;
export type ActiveTrendlineKind = Exclude<TrendlineKind, 'none'>;
export type ErrorDisplay = 'bars' | 'band';
export type NormalizationKind = 'none' | 'peak' | 'first' | 'minMax' | 'zScore';

export type SpectrumShape = 'gaussian' | 'lorentzian' | 'voigt' | 'logNormal' | 'splitGaussian';
export type SpectrumBaseline = 'constant' | 'linear' | 'zero';
export type SpectralAxisDirection = 'wavelengthToEnergy' | 'energyToWavelength';
export interface SpectrumFitConfig {
  seriesId: string;
  group?: string;
  shape: SpectrumShape;
  baseline?: SpectrumBaseline;
  count: number;
  centers?: number[];
}

export interface SeriesMapping {
  id: string;
  datasetId: string;
  name: string;
  xCol: number;
  yCol: number;
  errCol: number; // -1 = none
  groupCol: number; // -1 = none
  sizeCol: number; // -1 = none (bubble size for scatter)
  y2: boolean; // map to secondary y axis
  // per-series style overrides ('' / 0 = follow global)
  color: string; // '' = auto palette
  lineStyle: LineStyleKind;
  symbol: SymbolKind | ''; // '' = follow global
  opacity: number; // 0.1–1
  trendline: TrendlineKind;
  trendlines?: ActiveTrendlineKind[];
  errorDisplay: ErrorDisplay;
  normalization?: NormalizationKind;
}

export type AxisScale = 'linear' | 'log';
export type TickFormat = 'auto' | 'fixed0' | 'fixed1' | 'fixed2' | 'scientific' | 'percent';

export interface AxisConfig {
  label: string;
  scale: AxisScale;
  includeZero?: boolean;
  min: string; // '' = auto
  max: string;
  tickInside: boolean;
  showGrid: boolean;
  labelRotate: number; // degrees
  tickFormat: TickFormat;
}

export interface SpectralAxisPreference {
  direction: SpectralAxisDirection;
  density: boolean;
}

export interface SpectralAxisConfig extends SpectralAxisPreference {
  originalX: Pick<AxisConfig, 'label' | 'min' | 'max' | 'includeZero'>;
  originalY?: Pick<AxisConfig, 'label' | 'min' | 'max'>;
  originalY2?: Pick<AxisConfig, 'label' | 'min' | 'max'>;
}

export type LegendPosition = 'top' | 'bottom' | 'right' | 'insideTopLeft' | 'insideTopRight';

export interface ChartStyle {
  theme: string; // theme preset id
  fontFamily: string;
  fontSize: number;
  titleSize: number;
  lineWidth: number;
  symbolSize: number;
  showSymbols: boolean;
  smooth: boolean;
  step: boolean;
  palette: string;
  showLegend: boolean;
  legendPosition: LegendPosition;
  barGap: number; // percent
  stack: boolean;
  percentStack: boolean;
  barBorderRadius: number;
  histogramBins: number;
  pieDonut: number; // 0 = pie, 0.3–0.7 = donut inner radius ratio
  pieShowLabels: boolean;
  showDataLabels: boolean;
  boxShowPoints: boolean; // jittered raw points over box/violin
}

export interface ChartConfig {
  id: string;
  fileDatasetId?: string | null;
  type: ChartType;
  title: string;
  subtitle: string;
  series: SeriesMapping[];
  xAxis: AxisConfig;
  yAxis: AxisConfig;
  y2Axis: AxisConfig;
  style: ChartStyle;
  showPeakPositions?: boolean;
  showSpectrumComponents?: boolean;
  spectrumFit?: SpectrumFitConfig;
  spectrumFits?: SpectrumFitConfig[];
  spectralAxis?: SpectralAxisConfig;
  spectralAxisPreference?: SpectralAxisPreference;
  annotations?: Annotation[];
}

export type AnnotationKind =
  | 'arrow'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'sig'
  | 'pen';

export interface AnnotationStyle {
  stroke: string;
  strokeWidth: number;
  fill: string; // 'none' allowed
  fontSize: number;
  dash: boolean;
}

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  /** Normalized 0-1 figure coordinates: [x1,y1,x2,y2] or pen path points */
  points: number[];
  text: string;
  style: AnnotationStyle;
}

export type ToolId = 'select' | AnnotationKind;

export interface FigureLayout {
  rows: number;
  cols: number;
  showPanelLabels: boolean;
}

export type FigureView = 'single' | 'layout';

export interface JournalPreset {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
}

export interface ProjectFile {
  app: 'sciplot';
  version: 1 | 2 | 3;
  datasets: Dataset[];
  charts: ChartConfig[];
  activeChartId?: string;
  figureView?: FigureView;
  layout: FigureLayout;
  annotations: Annotation[];
  canvasAnnotations: Annotation[];
  figureWidthMm: number;
  figureHeightMm: number;
}
