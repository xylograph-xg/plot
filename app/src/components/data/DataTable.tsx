import { Fragment, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { parseCell } from '../../lib/parse';
import type { Dataset } from '../../types';

export function DataTable({ dataset, rowIndices }: { dataset: Dataset; rowIndices: number[] }) {
  const { t } = useTranslation();
  const updateCell = useStore((s) => s.updateCell);
  const updateColumnName = useStore((s) => s.updateColumnName);
  const addRow = useStore((s) => s.addRow);
  const addColumn = useStore((s) => s.addColumn);
  const deleteRow = useStore((s) => s.deleteRow);
  const deleteColumn = useStore((s) => s.deleteColumn);
  const sortByColumn = useStore((s) => s.sortByColumn);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [selectedCol, setSelectedCol] = useState<number | null>(null);
  const [sortState, setSortState] = useState<{ col: number; asc: boolean } | null>(null);
  const [draft, setDraft] = useState<{ row: number; column: number; value: string } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const editingIndex = draft ? rowIndices.indexOf(draft.row) : -1;
  // The virtualizer owns scroll state and intentionally returns a stable instance.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rowIndices.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 26,
    overscan: 5,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range);
      if (editingIndex < 0 || indices.includes(editingIndex)) return indices;
      return [...indices, editingIndex].sort((a, b) => a - b);
    },
  });
  const visibleRows = virtualizer.getVirtualItems();
  const spacer = (height: number) => height > 0 && (
    <tr aria-hidden="true"><td colSpan={dataset.columns.length + 1} style={{ height, padding: 0 }} /></tr>
  );

  const commitCell = (row: number, col: number, raw: string) => {
    const value = parseCell(raw, dataset.textColumns?.includes(col));
    if (value !== dataset.rows[row]?.[col]) updateCell(dataset.id, row, col, value);
  };

  const onSort = (col: number) => {
    const asc = sortState?.col === col ? !sortState.asc : true;
    setSortState({ col, asc });
    sortByColumn(dataset.id, col, asc);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-1.5 px-3 py-1.5 flex-wrap">
        <button className="btn !px-2 !py-1 text-[11px]" onClick={() => addRow(dataset.id)}>
          + {t('data.addRow')}
        </button>
        <button className="btn !px-2 !py-1 text-[11px]" onClick={() => addColumn(dataset.id)}>
          + {t('data.addCol')}
        </button>
        {selectedRow !== null && rowIndices.includes(selectedRow) && (
          <button
            className="btn !px-2 !py-1 text-[11px] !text-red-500"
            onClick={() => {
              deleteRow(dataset.id, selectedRow);
              setSelectedRow(null);
            }}
          >
            {t('data.delRow')}
          </button>
        )}
        {selectedCol !== null && dataset.columns.length > 1 && (
          <button
            className="btn !px-2 !py-1 text-[11px] !text-red-500"
            onClick={() => {
              deleteColumn(dataset.id, selectedCol);
              setSelectedCol(null);
            }}
          >
            {t('data.delCol')}
          </button>
        )}
      </div>
      <div ref={scroll} className="flex-1 overflow-auto px-1 pb-1">
        <table className="table-fixed border-collapse w-full text-[11px]"
          style={{ minWidth: 32 + dataset.columns.length * 64 }} aria-rowcount={rowIndices.length + 1}>
          <colgroup>
            <col style={{ width: 32 }} />
            {dataset.columns.map((_, column) => <col key={column} />)}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              <th
                className="w-8 px-1 py-1 text-[10px] font-normal border"
                style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border)', color: 'var(--text-3)' }}
              >
                #
              </th>
              {dataset.columns.map((c, ci) => (
                <th
                  key={ci}
                  className="border p-0 min-w-16"
                  style={{
                    background: selectedCol === ci ? 'color-mix(in srgb, var(--color-accent) 18%, var(--bg-subtle))' : 'var(--bg-subtle)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div className="flex items-center">
                    <input
                      className="w-full px-1.5 py-1 font-semibold text-[11px] bg-transparent outline-none text-center min-w-0"
                      style={{ color: 'var(--text-1)' }}
                      defaultValue={c}
                      key={`${dataset.id}-${ci}-${c}`}
                      onFocus={() => setSelectedCol(ci)}
                      onBlur={(e) => updateColumnName(dataset.id, ci, e.target.value || c)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                    <button
                      className="px-0.5 text-[9px] shrink-0 cursor-pointer"
                      style={{ color: sortState?.col === ci ? 'var(--color-accent)' : 'var(--text-3)' }}
                      title={t('data.sort')}
                      onClick={() => onSort(ci)}
                    >
                      {sortState?.col === ci ? (sortState.asc ? '▲' : '▼') : '⇅'}
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((item, index) => {
              const ri = rowIndices[item.index];
              const previousEnd = visibleRows[index - 1]?.end ?? 0;
              return <Fragment key={ri}>
                {spacer(item.start - previousEnd)}
                <tr style={{ height: item.size }} aria-rowindex={item.index + 2}>
                <td
                  className="px-1 text-center text-[10px] border cursor-pointer select-none"
                  style={{
                    borderColor: 'var(--border)',
                    color: selectedRow === ri ? '#fff' : 'var(--text-3)',
                    background: selectedRow === ri ? 'var(--color-accent)' : 'var(--bg-subtle)',
                  }}
                  onClick={() => setSelectedRow(selectedRow === ri ? null : ri)}
                >
                  {ri + 1}
                </td>
                {dataset.rows[ri].map((cell, ci) => (
                  <td key={ci} className="border p-0" style={{ borderColor: 'var(--border)' }}>
                    <input
                      className="w-full px-1.5 py-0.5 bg-transparent outline-none focus:bg-[var(--bg-subtle)]"
                      style={{
                        color: typeof cell === 'number' ? 'var(--text-1)' : 'var(--color-accent)',
                        textAlign: typeof cell === 'number' ? 'right' : 'left',
                      }}
                      value={draft?.row === ri && draft.column === ci ? draft.value : String(cell ?? '')}
                      onFocus={(event) => setDraft({ row: ri, column: ci, value: event.target.value })}
                      onChange={(event) => setDraft({ row: ri, column: ci, value: event.target.value })}
                      onBlur={(event) => {
                        commitCell(ri, ci, event.target.value);
                        setDraft(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </td>
                ))}
                </tr>
              </Fragment>;
            })}
            {spacer(virtualizer.getTotalSize() - (visibleRows.at(-1)?.end ?? 0))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
