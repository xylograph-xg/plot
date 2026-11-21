import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FitModelChoice, FitWindowData } from '../../lib/fitWindows';
import type { ActiveTrendlineKind, ChartConfig, Dataset } from '../../types';
import { useChartRenderer } from '../chart/useChartRenderer';
import { ResidualStrip, residualStripHeight } from '../chart/ResidualStrip';
import type { ResidualPlot } from '../../lib/residuals';
import { selectedTrendlines, setTrendline, trendlineSelection } from '../../lib/trendlineSelection';
import { FitControls } from './FitTab';

function Preview({ chart, datasets }: { chart: ChartConfig; datasets: Dataset[] }) {
  const [residuals, setResiduals] = useState<ResidualPlot | null>(null);
  const { ref } = useChartRenderer(chart, datasets, setResiduals);
  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div ref={ref} data-fit-preview className="min-h-0 w-full flex-1" />
      {residuals && (
        <div className="shrink-0" style={{ height: residualStripHeight }}>
          <ResidualStrip plot={residuals} chart={chart} width={residuals.width} />
        </div>
      )}
    </div>
  );
}

export function FitWindow() {
  const { t } = useTranslation();
  const [source, setSource] = useState<FitWindowData | null>();
  const [draft, setDraft] = useState<Map<string, Map<ActiveTrendlineKind, boolean>>>(new Map());
  const [status, setStatus] = useState<'applied' | 'failed'>();
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', localStorage.getItem('sciplot-theme') === 'dark');
    const bridge = window.fitWindows;
    if (!bridge) return;
    let mounted = true;
    let changed = false;
    const receive = bridge.onChange((data) => {
      changed = true;
      setSource(data);
    });
    void bridge.get().then((data) => { if (mounted && !changed) setSource(data); })
      .catch(() => { if (mounted && !changed) setSource(null); });
    return () => { mounted = false; receive(); };
  }, []);

  const name = source?.chart.title || source?.datasets[0]?.name;
  const title = name ? `${t('fit.windowTitle')} · ${name}` : t('fit.windowTitle');
  useEffect(() => { document.title = title; }, [title]);
  const chart = useMemo(() => source && ({
    ...source.chart,
    series: source.chart.series.map((item) => {
      const changes = draft.get(item.id);
      const active = selectedTrendlines(item);
      let methods = active;
      for (const [kind, enabled] of changes ?? []) methods = setTrendline(methods, kind, enabled);
      return methods === active ? item : { ...item, ...trendlineSelection(methods) };
    }),
  }), [source, draft]);

  if (!source || !chart) return (
    <p role="status" className="p-4 text-sm text-(--text-2)">{t(source === undefined ? 'fit.loadingWindow' : 'fit.chartMissing')}</p>
  );

  const choices: FitModelChoice[] = [];
  for (const item of source.chart.series) {
    const active = selectedTrendlines(item);
    for (const [kind, enabled] of draft.get(item.id) ?? []) {
      if (active.includes(kind) !== enabled) choices.push([item.id, kind, enabled]);
    }
  }
  const apply = async () => {
    setApplying(true);
    try {
      const ok = await window.fitWindows?.apply(choices);
      if (ok) setDraft((previous) => {
        const next = new Map(previous);
        for (const [id, method, enabled] of choices) {
          const changes = next.get(id);
          if (changes?.get(method) !== enabled) continue;
          const remaining = new Map(changes);
          remaining.delete(method);
          if (remaining.size) next.set(id, remaining);
          else next.delete(id);
        }
        return next;
      });
      setStatus(ok ? 'applied' : 'failed');
    } catch {
      setStatus('failed');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-(--border) bg-(--bg-panel) px-3 py-2">
        <h1 className="truncate text-sm font-semibold" title={title}>{title}</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 bg-(--bg-canvas) p-3">
          <Preview chart={chart} datasets={source.datasets} />
        </main>
        <aside className="w-65 shrink-0 overflow-y-auto border-l border-(--border) bg-(--bg-panel)">
          <FitControls chart={chart} datasets={source.datasets} onModel={(id, method) => {
            const item = chart.series.find((mapping) => mapping.id === id);
            if (!item) return;
            setStatus(undefined);
            const enabled = !selectedTrendlines(item).includes(method);
            setDraft((previous) => new Map(previous).set(id, new Map(previous.get(id)).set(method, enabled)));
          }} toolbar={
            <>
              <button className="btn-primary w-full disabled:opacity-50" disabled={applying || !choices.length}
                onClick={() => void apply()}>{t('fit.applyToChart')}</button>
              {status && <p role="status" className="text-xs text-(--text-2)">{t(status === 'applied' ? 'fit.applied' : 'fit.windowError')}</p>}
            </>
          } />
        </aside>
      </div>
    </div>
  );
}
