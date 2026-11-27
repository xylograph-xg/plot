import { Fragment, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { ChartSelection, SelectedMeasurement } from '../../lib/chartSelection';
import { fitNumber } from '../../lib/fitResultText';
import { useStore } from '../../store/useStore';
import type { Dataset } from '../../types';
import { DataTable } from './DataTable';

function MeasurementTable({ points }: { points: SelectedMeasurement[] }) {
  const { t } = useTranslation();
  const scroll = useRef<HTMLDivElement>(null);
  // The virtualizer owns scroll state and intentionally returns a stable instance.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({ count: points.length, getScrollElement: () => scroll.current,
    estimateSize: () => 24, overscan: 5 });
  const rows = virtualizer.getVirtualItems();
  const spacer = (height: number) => height > 0 && <tr aria-hidden="true"><td colSpan={3} style={{ height }} /></tr>;
  const value = (coordinate: number | string, digits: number) => typeof coordinate === 'number'
    ? fitNumber(coordinate, digits) : coordinate;

  return (
    <div ref={scroll} className="min-h-0 flex-1 overflow-auto">
      <table aria-label={t('selection.title')} aria-rowcount={points.length + 1} className="w-full table-fixed text-[11px]">
        <thead className="sticky top-0 bg-(--bg-subtle) text-left">
          <tr>
            <th className="px-2 py-1">{t('selection.curve')}</th>
            <th className="px-2 text-right">X</th>
            <th className="px-2 text-right">Y</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => {
            const point = points[item.index];
            return (
              <Fragment key={item.key}>
                {spacer(item.start - (rows[index - 1]?.end ?? 0))}
                <tr style={{ height: item.size }} aria-rowindex={item.index + 2} className="odd:bg-(--bg-subtle)">
                  <td className="truncate px-2" title={point.series}>{point.series}</td>
                  <td className="truncate px-2 text-right font-mono" title={String(point.x)}>{value(point.x, 7)}</td>
                  <td className="truncate px-2 text-right font-mono" title={String(point.y)}>{value(point.y, 5)}</td>
                </tr>
              </Fragment>
            );
          })}
          {spacer(virtualizer.getTotalSize() - (rows.at(-1)?.end ?? 0))}
        </tbody>
      </table>
    </div>
  );
}

export function SelectionPanel({ selection, datasets }: { selection: ChartSelection; datasets: Dataset[] }) {
  const { t } = useTranslation();
  const [showSource, setShowSource] = useState(false);
  const [sourceId, setSourceId] = useState<string>();
  const rowsBySource = useMemo(() => {
    const rows = new Map<string, Set<number>>();
    if (!showSource) return rows;
    for (const point of selection.points) {
      const earlier = rows.get(point.datasetId);
      if (earlier) earlier.add(point.row);
      else rows.set(point.datasetId, new Set([point.row]));
    }
    return rows;
  }, [selection.points, showSource]);
  const sources = showSource ? datasets.filter(({ id }) => rowsBySource.has(id)) : [];
  const source = sources.find(({ id }) => id === sourceId) ?? sources[0];
  const selectedRows = source ? [...(rowsBySource.get(source.id) ?? [])].sort((a, b) => a - b) : [];

  return (
    <section aria-label={t('selection.title')} className="mt-auto flex h-[44%] min-h-24 flex-col border-t border-(--border)">
      <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        <h2 className="mr-auto text-[11px] font-semibold">{t('selection.title')}</h2>
        {selection.points.length > 0 && <button type="button" className="btn !px-1.5 !py-0.5 text-[11px]"
          aria-pressed={showSource} onClick={() => setShowSource(!showSource)}>{t('selection.source')}</button>}
        <button type="button" className="btn !px-1.5 !py-0.5 text-[11px]" onClick={() => useStore.getState().setDataSelection(null)}>
          {t('selection.clear')}
        </button>
      </div>
      <p className="shrink-0 px-2 pb-1 text-[11px] text-(--text-2)" role="status">
        {selection.points.length ? t('selection.count', { count: selection.points.length }) : t('selection.empty')}
      </p>
      {source && sources.length > 1 && <div className="shrink-0 px-2 pb-1">
        <select className="input" aria-label={t('chart.dataset')} value={source.id} onChange={(event) => setSourceId(event.target.value)}>
          {sources.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>}
      {source ? <DataTable key={source.id} dataset={source} rowIndices={selectedRows} />
        : selection.points.length > 0 && <MeasurementTable points={selection.points} />}
    </section>
  );
}
