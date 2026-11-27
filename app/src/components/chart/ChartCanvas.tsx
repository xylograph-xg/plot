import { panelLabel } from '../../lib/chartSources';
import { getTheme } from '../../lib/themes';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentAnnotations, useStore } from '../../store/useStore';
import { millimetersToPixels } from '../../lib/journals';
import { ChartPanel } from './ChartPanel';
import { SpectralAxisToggle } from './SpectralAxisToggle';
import { ResidualStrip, residualStripHeight } from './ResidualStrip';
import type { ResidualPlot } from '../../lib/residuals';
import { AnnotationLayer } from '../annotate/AnnotationLayer';
import { AnnotationToolbar } from '../annotate/AnnotationToolbar';
import { supportsChartSelection } from '../../lib/chartSelection';
import { isEditableTarget } from '../../lib/preferences';

export const FIGURE_DOM_ID = 'sciplot-figure';

export function ChartCanvas() {
  const { t } = useTranslation();
  const charts = useStore((s) => s.charts);
  const layout = useStore((s) => s.layout);
  const figureView = useStore((s) => s.figureView);
  const setFigureView = useStore((s) => s.setFigureView);
  const annotations = useStore(currentAnnotations);
  const figureWidthMm = useStore((s) => s.figureWidthMm);
  const figureHeightMm = useStore((s) => s.figureHeightMm);
  const activeChart = useStore((s) => s.charts.find((c) => c.id === s.activeChartId));
  const selecting = useStore((s) => s.tool === 'selectData');
  const canSelect = activeChart && supportsChartSelection(activeChart.type) && activeChart.series.length > 0;

  useEffect(() => {
    const clear = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isEditableTarget(event.target)) return;
      const state = useStore.getState();
      if (state.dataSelection) state.setDataSelection(null);
      if (state.tool === 'selectData') state.setTool('select');
    };
    window.addEventListener('keydown', clear);
    return () => window.removeEventListener('keydown', clear);
  }, []);

  const W = millimetersToPixels(figureWidthMm);
  const H = millimetersToPixels(figureHeightMm);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [autoFit, setAutoFit] = useState(true);
  const [residuals, setResiduals] = useState<Record<string, ResidualPlot>>({});
  const onResiduals = useCallback((id: string, plot: ResidualPlot | null) => {
    setResiduals((current) => {
      if (plot) return { ...current, [id]: plot };
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const visibleCharts = figureView === 'single' && activeChart ? [activeChart] : charts;
  const cols = figureView === 'single' ? 1 : layout.cols;
  const rows = figureView === 'single' ? 1 : layout.rows;
  const cellW = Math.floor(W / cols);
  const cellH = Math.floor(H / rows);
  const residualRows = Array.from({ length: rows }, (_, row) => visibleCharts.slice(row * cols, (row + 1) * cols)
    .map((chart, col) => ({ chart, index: row * cols + col, plot: residuals[chart.id] })))
    .filter((row) => row.some(({ plot }) => plot));
  const displayHeight = H + residualRows.length * residualStripHeight;

  useLayoutEffect(() => {
    if (!autoFit) return;
    const el = wrapRef.current;
    if (!el) return;
    const compute = () => {
      const pad = 48;
      const z = Math.min(
        (el.clientWidth - pad) / W,
        (el.clientHeight - pad) / displayHeight,
        2,
      );
      setZoom(Math.max(0.2, z));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, displayHeight, autoFit]);

  const panelLabels = figureView === 'layout' && layout.showPanelLabels && visibleCharts.length > 1
    ? visibleCharts.map((chart, i) => ({
        x: (i % layout.cols) * cellW + 8,
        y: Math.floor(i / layout.cols) * cellH + chart.style.titleSize + 6,
        fontSize: chart.style.titleSize + 2,
        label: panelLabel(i),
        color: getTheme(chart.style.theme).textColor,
      }))
    : [];

  return (
    <div className="flex flex-col h-full min-w-0">
      <AnnotationToolbar chartActions={<>
        <button type="button" className="btn shrink-0 !py-1 text-[11px] aria-pressed:!border-accent
          aria-pressed:!text-accent disabled:opacity-50" aria-pressed={selecting} disabled={!canSelect && !selecting}
          title={t('selection.drag')}
          onClick={() => useStore.getState().setTool(selecting ? 'select' : 'selectData')}>
          {t('selection.tool')}
        </button>
        <SpectralAxisToggle chart={activeChart} />
      </>} />
      {charts.length > 1 && (
        <div className="flex shrink-0 gap-1.5 border-b border-(--border) bg-(--bg-panel) px-3 py-1">
          {(['single', 'layout'] as const).map((view) => (
            <button key={view} className="btn !py-0.5 aria-pressed:!text-accent" aria-pressed={figureView === view}
              onClick={() => setFigureView(view)}>{t(`chart.view.${view}`)}</button>
          ))}
        </div>
      )}
      <div
        ref={wrapRef}
        className="flex-1 overflow-auto relative"
        style={{ background: 'var(--bg-canvas)' }}
      >
        <div
          className="absolute"
          style={{
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) scale(${zoom})`,
          }}
        >
          <div
            id={FIGURE_DOM_ID}
            className="relative shadow-xl"
            style={{ width: W, background: '#ffffff' }}
          >
            <div data-figure-main="true" className="relative" style={{ height: H }}>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
                  gridTemplateRows: `repeat(${rows}, ${cellH}px)`,
                }}
              >
                {visibleCharts.map((c) => (
                  <ChartPanel key={c.id} chart={c} width={cellW} height={cellH} onResiduals={onResiduals} />
                ))}
              </div>
              <AnnotationLayer
                key={figureView === 'single' ? activeChart?.id ?? 'single' : 'layout'}
                width={W}
                height={H}
                annotations={annotations}
                interactive={!selecting}
                panelLabels={panelLabels}
                labelFont={activeChart?.style.fontFamily ?? 'Arial'}
              />
            </div>
            {residualRows.map((row) => (
              <div key={row[0].chart.id} className="grid" style={{
                gridTemplateColumns: `repeat(${cols}, ${cellW}px)`, height: residualStripHeight,
              }}>
                {row.map(({ chart, index, plot }) => plot
                  ? <ResidualStrip key={chart.id} plot={plot} chart={chart} width={cellW}
                      panel={figureView === 'layout' && visibleCharts.length > 1 ? panelLabel(index) : undefined} />
                  : <div key={chart.id} />)}
              </div>
            ))}
          </div>
        </div>
        {/* zoom controls */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1 panel rounded-lg px-1.5 py-1 z-20">
          <button
            className="tool-btn !w-6 !h-6"
            onClick={() => {
              setAutoFit(false);
              setZoom((z) => Math.max(0.2, z - 0.1));
            }}
          >
            −
          </button>
          <span className="text-[11px] w-10 text-center" style={{ color: 'var(--text-2)' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="tool-btn !w-6 !h-6"
            onClick={() => {
              setAutoFit(false);
              setZoom((z) => Math.min(3, z + 0.1));
            }}
          >
            +
          </button>
          <button className="tool-btn !w-6 !h-6 text-[10px]" onClick={() => setAutoFit(true)}>
            ⊡
          </button>
        </div>
      </div>
    </div>
  );
}
