import { reportError } from '../../lib/diagnostics';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { JOURNAL_PRESETS, figureSizeLimits, validFigureDimension } from '../../lib/journals';
import {
  downloadFigure,
  readProjectFile,
  saveProjectFile,
} from '../../lib/export';
import { FIGURE_DOM_ID } from '../chart/ChartCanvas';
import { CANVAS_DOM_ID } from '../freecanvas/FreeCanvas';

function FigureDimensionField({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  const [draft, setDraft] = useState<string>();
  const invalid = draft !== undefined && !validFigureDimension(Number(draft));
  return (
    <label>
      <span className="label">{label}</span>
      <input type="number" className="input" aria-invalid={invalid} value={draft ?? value}
        min={figureSizeLimits.min} max={figureSizeLimits.max}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== undefined && !invalid) onChange(Number(draft));
          setDraft(undefined);
        }}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    </label>
  );
}

export function ExportTab() {
  const { t } = useTranslation();
  const mode = useStore((s) => s.mode);
  const figureWidthMm = useStore((s) => s.figureWidthMm);
  const figureHeightMm = useStore((s) => s.figureHeightMm);
  const setFigureSize = useStore((s) => s.setFigureSize);
  const exportDpi = useStore((s) => s.exportDpi);
  const setExportDpi = useStore((s) => s.setExportDpi);
  const serializeProject = useStore((s) => s.serializeProject);
  const loadProject = useStore((s) => s.loadProject);

  const [preset, setPreset] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'figureError' | 'projectError'>();
  const projectInputRef = useRef<HTMLInputElement>(null);

  const targetEl = () =>
    document.getElementById(mode === 'chart' ? FIGURE_DOM_ID : CANVAS_DOM_ID);
  const filename = mode === 'chart' ? 'sciplot-figure' : 'sciplot-canvas';

  const run = async (fn: (el: HTMLElement) => Promise<void> | void) => {
    const el = targetEl();
    if (!el || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await fn(el);
    } catch (err) {
      reportError('Export figure', err);
      setError('figureError');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1 pb-4">
      {error && <p role="alert" className="px-3 text-xs text-red-500">{t(`exportP.${error}`)}</p>}
      <div className="section-title">{t('exportP.journal')}</div>
      <div className="px-3 space-y-2">
        <select
          className="input"
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value);
            const p = JOURNAL_PRESETS.find((j) => j.id === e.target.value);
            if (p) setFigureSize(p.widthMm, p.heightMm);
          }}
        >
          <option value="">{t('exportP.custom')}</option>
          {JOURNAL_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(`presetNames.journals.${p.id}`, { defaultValue: p.name })}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <FigureDimensionField label={t('exportP.width')} value={figureWidthMm}
            onChange={(width) => { setPreset(''); setFigureSize(width, figureHeightMm); }} />
          <FigureDimensionField label={t('exportP.height')} value={figureHeightMm}
            onChange={(height) => { setPreset(''); setFigureSize(figureWidthMm, height); }} />
        </div>
      </div>

      <div className="section-title">{t('exportP.export')}</div>
      <div className="px-3 space-y-2">
        {mode === 'canvas' && (
          <div className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
            {t('exportP.canvasExportHint')}
          </div>
        )}
        {mode === 'chart' && <p className="text-[11px] text-(--text-3)">{t('exportP.residualsHint')}</p>}
        <div>
          <span className="label">{t('exportP.dpi')}</span>
          <select className="input" value={exportDpi} onChange={(e) => setExportDpi(Number(e.target.value))}>
            {[150, 300, 600, 1200].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary w-full" disabled={busy}
          onClick={() => run((el) => downloadFigure(el, filename, exportDpi))}>
          {t('exportP.png')}
        </button>
      </div>

      <div className="section-title">{t('exportP.project')}</div>
      <div className="px-3 grid grid-cols-2 gap-1.5">
        <button className="btn" onClick={() => saveProjectFile(serializeProject())}>
          {t('exportP.save')}
        </button>
        <button className="btn" onClick={() => projectInputRef.current?.click()}>
          {t('exportP.load')}
        </button>
        <input
          ref={projectInputRef}
          type="file"
          accept=".json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              setError(undefined);
              loadProject(await readProjectFile(f));
            } catch (err) {
              reportError('Read project', err);
              setError('projectError');
            }
          }}
        />
      </div>
    </div>
  );
}
