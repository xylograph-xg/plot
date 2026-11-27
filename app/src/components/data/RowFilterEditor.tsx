import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AutoStartMode, Dataset, FilterOperator } from '../../types';
import { useStore } from '../../store/useStore';
import { defaultPlateauPoints, minPlateauPoints, maxPlateauPoints, scanRowFilter, validPlateauPoints } from '../../lib/autoStart';
import { numericColumnIndices } from '../../lib/parse';
import { AutoStartSelect } from './AutoStartSelect';

const operators: FilterOperator[] = ['equals', 'contains', 'gte', 'lte', 'empty'];

export function RowFilterEditor({ dataset, count }: { dataset: Dataset; count: number }) {
  const { t } = useTranslation();
  const setRowFilter = useStore((state) => state.setRowFilter);
  const activeY = useStore((state) => state.charts.find((chart) => chart.id === state.activeChartId)
    ?.series.find((series) => series.datasetId === dataset.id)?.yCol);
  const defaultPoints = useStore((state) => state.defaultTemplate?.plateauPoints ?? defaultPlateauPoints);
  const defaultMode = useStore((state) => state.defaultTemplate?.scanMode ?? 'drop');
  const importIssue = useStore((state) => state.autoScanIssue?.datasetId === dataset.id ? state.autoScanIssue.issue : undefined);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState<number>();
  const [customPoints, setCustomPoints] = useState<string>();
  const [scanMode, setScanMode] = useState<AutoStartMode>();
  const [scanError, setScanError] = useState<'dropNotFound' | 'riseNotFound' | 'beyondEnd' | 'invalidPoints'>();
  const active = dataset.rowFilter;
  const inputColumn = selectedColumn ?? active?.autoStart?.column ?? activeY;
  const column = inputColumn !== undefined && dataset.columns[inputColumn] !== undefined
    ? inputColumn : numericColumnIndices(dataset).at(-1) ?? 0;
  const points = customPoints ?? String(active?.autoStart?.plateauPoints ?? defaultPoints);
  const mode = scanMode ?? active?.autoStart?.mode ?? defaultMode;

  const autoScan = () => {
    const plateauPoints = Number(points);
    if (!validPlateauPoints(plateauPoints)) {
      setScanError('invalidPoints');
      setOpen(true);
      return;
    }
    const result = scanRowFilter(dataset, { column, plateauPoints, mode });
    if (typeof result === 'string') {
      setScanError(result === 'notFound' ? `${mode}NotFound` : result);
      return;
    }
    setScanError(undefined);
    setRowFilter(dataset.id, result);
  };

  return (
    <div className="shrink-0 px-3 pb-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>{t('filter.title')}</button>
          <button className="btn" onClick={autoScan}>{t('autoStart.scan')}</button>
        </div>
        <span className="text-[11px]" aria-live="polite">
          {t('filter.count', { count, total: dataset.rows.length })}
        </span>
      </div>
      {active?.autoStart && active.first !== undefined && (
        <div role="status" className="my-1 rounded bg-(--bg-subtle) p-1.5 text-[11px] text-(--text-2)">
          {t('autoStart.detected', {
            row: active.first, column: dataset.columns[active.autoStart.column], mode: t(`autoStart.${active.autoStart.mode ?? 'drop'}`),
          })}
        </div>
      )}
      {(scanError || importIssue) && <p role="status" className="py-1 text-[11px] text-(--text-2)">
        {t(`autoStart.${scanError ?? importIssue}`, { min: minPlateauPoints, max: maxPlateauPoints })}
      </p>}
      {open && (
        <form
          key={JSON.stringify(active)}
          className="grid gap-1.5 pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const first = Number(form.get('first') || 1);
            const lastInput = form.get('last');
            const last = lastInput ? Number(lastInput) : undefined;
            const columnInput = form.get('column');
            const column = Number(columnInput ?? '');
            const operator = form.get('operator') as FilterOperator;
            const value = String(form.get('value') ?? '').trim();
            const condition = columnInput !== '' ? { column, operator, value } : undefined;
            const needsNumber = operator === 'gte' || operator === 'lte';

            if (!Number.isSafeInteger(first) || first < 1 ||
                (last !== undefined && (!Number.isSafeInteger(last) || first > last)) ||
                (condition && operator !== 'empty' && (!value || (needsNumber && !Number.isFinite(Number(value)))))) {
              setError(true);
              return;
            }
            setError(false);
            setScanError(undefined);
            setRowFilter(dataset.id, first > 1 || last !== undefined || condition
              ? { first, last, condition, autoStart: first === active?.first ? active.autoStart : undefined }
              : undefined);
          }}
        >
          <div className="grid grid-cols-2 gap-1">
            <input className="input" aria-label={t('filter.first')} placeholder={t('filter.first')}
              name="first" type="number" min={1} max={Number.MAX_SAFE_INTEGER} defaultValue={active?.first} />
            <input className="input" aria-label={t('filter.last')} placeholder={t('filter.last')}
              name="last" type="number" min={1} max={Number.MAX_SAFE_INTEGER} defaultValue={active?.last} />
          </div>
          <select className="input" aria-label={t('filter.column')} name="column" defaultValue={active?.condition?.column ?? ''}>
            <option value="">{t('filter.none')}</option>
            {dataset.columns.map((name, index) => (
              <option key={index} value={index}>{index + 1}. {name}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-1">
            <select className="input" aria-label={t('filter.operator')} name="operator" defaultValue={active?.condition?.operator}>
              {operators.map((operator) => <option key={operator} value={operator}>{t(`filter.${operator}`)}</option>)}
            </select>
            <input className="input" aria-label={t('filter.value')} placeholder={t('filter.value')}
              name="value" defaultValue={active?.condition?.value} />
          </div>
          {error && <p role="alert" className="text-[11px] text-red-500">{t('filter.invalid')}</p>}
          <div className="flex gap-1.5">
            <button type="submit" className="btn-primary">{t('filter.apply')}</button>
            <button type="reset" className="btn" onClick={() => { setError(false); setScanError(undefined); setRowFilter(dataset.id, undefined); }}>
              {t('filter.clear')}
            </button>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1 border-t border-(--border) pt-1.5">
            <div className="col-span-2">
              <span className="label">{t('autoStart.mode')}</span>
              <AutoStartSelect value={mode} onChange={(next) => { if (next) setScanMode(next); setScanError(undefined); }} />
            </div>
            <label>
              <span className="label">{t('autoStart.column')}</span>
              <select className="input" value={column} onChange={(e) => setSelectedColumn(Number(e.target.value))}>
                {dataset.columns.map((name, index) => <option key={index} value={index}>{name}</option>)}
              </select>
            </label>
            <label>
              <span className="label">{t('autoStart.plateauPoints')}</span>
              <input className="input" type="number" min={minPlateauPoints} max={maxPlateauPoints} value={points}
                onChange={(e) => setCustomPoints(e.target.value)} />
            </label>
          </div>
        </form>
      )}
    </div>
  );
}
