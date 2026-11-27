import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultPlateauPoints, minPlateauPoints, maxPlateauPoints, validPlateauPoints } from '../../lib/autoStart';
import { useStore } from '../../store/useStore';
import type { AutoStartMode } from '../../types';
import { AutoStartSelect } from '../data/AutoStartSelect';

export function DefaultTemplate({ chartId }: { chartId: string }) {
  const { t } = useTranslation();
  const template = useStore((state) => state.defaultTemplate);
  const dataset = useStore((state) => {
    const chart = state.charts.find((item) => item.id === chartId);
    return state.datasets.find((item) => item.id === chart?.series[0]?.datasetId);
  });
  const currentRule = dataset?.rowFilter?.autoStart;
  const [scan, setScan] = useState<AutoStartMode | ''>();
  const [points, setPoints] = useState<string>();
  const [column, setColumn] = useState<string>();
  const [message, setMessage] = useState<'saved' | 'cleared' | 'failed'>();
  const mode = scan ?? (template ? template.scanOnImport ? template.scanMode ?? 'drop' : ''
    : currentRule ? currentRule.mode ?? 'drop' : '');
  const plateauPoints = points ?? String(template?.plateauPoints ?? currentRule?.plateauPoints ?? defaultPlateauPoints);
  const columns = dataset?.columns ?? [];
  const preferred = column ?? template?.scanColumn ?? (currentRule ? columns[currentRule.column] : '');
  const signal = preferred && (columns.length === 0 || columns.includes(preferred)) ? preferred : '';

  return (
    <section>
      <h2 className="section-title">{t('template.title')}</h2>
      <div className="mx-3 space-y-2 rounded-lg border border-(--border) p-2">
        <div className="flex flex-wrap gap-1.5">
          <button className="btn" type="button" onClick={() => {
            const count = mode ? Number(plateauPoints) : template?.plateauPoints ?? defaultPlateauPoints;
            const saved = useStore.getState().saveDefaultTemplate(chartId, {
              scanOnImport: Boolean(mode), scanMode: mode || undefined, plateauPoints: count, scanColumn: signal || undefined,
            });
            if (saved) setPoints(undefined);
            setMessage(saved ? 'saved' : 'failed');
          }} disabled={Boolean(mode) && !validPlateauPoints(Number(plateauPoints))}>
            {t('template.save')}
          </button>
          {template && (
            <button className="btn" type="button" onClick={() => {
              const cleared = useStore.getState().clearDefaultTemplate();
              if (cleared) {
                setScan(undefined);
                setPoints(undefined);
                setColumn(undefined);
              }
              setMessage(cleared ? 'cleared' : 'failed');
            }}>{t('template.clear')}</button>
          )}
        </div>
        <div>
          <span className="label">{t('template.scanOnImport')}</span>
          <AutoStartSelect value={mode} onChange={setScan} allowNone />
        </div>
        {mode && (
          <div className="grid grid-cols-2 gap-1.5">
            <label>
              <span className="label">{t('autoStart.column')}</span>
              <select className="input" value={signal ?? ''} onChange={(event) => setColumn(event.target.value)}>
                <option value="">{t('autoStart.firstY')}</option>
                {(columns.length ? columns : signal ? [signal] : []).map((name, index) =>
                  <option key={index} value={name}>{name}</option>)}
              </select>
            </label>
            <label>
              <span className="label">{t('autoStart.plateauPoints')}</span>
              <input className="input" type="number" min={minPlateauPoints} max={maxPlateauPoints} value={plateauPoints}
                onChange={(event) => setPoints(event.target.value)} />
            </label>
          </div>
        )}
        {(message || template) && (
          <p role="status" className="text-[11px] text-(--text-2)">{t(`template.${message ?? 'enabled'}`)}</p>
        )}
      </div>
    </section>
  );
}
