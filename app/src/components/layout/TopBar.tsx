import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { useStore } from '../../store/useStore';

function useUndoRedo() {
  const temporal = useStore.temporal;
  const { pastStates, futureStates } = useStoreWithEqualityFn(
    temporal,
    (s) => ({ pastStates: s.pastStates, futureStates: s.futureStates }),
    (a, b) => a.pastStates.length === b.pastStates.length && a.futureStates.length === b.futureStates.length,
  );
  return {
    canUndo: pastStates.length > 0,
    canRedo: futureStates.length > 0,
    undo: () => temporal.getState().undo(),
    redo: () => temporal.getState().redo(),
  };
}

export function TopBar() {
  const { t, i18n } = useTranslation();
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const [dark, setDark] = useState(() => localStorage.getItem('sciplot-theme') === 'dark');
  const { canUndo, canRedo, undo, redo } = useUndoRedo();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('sciplot-theme', dark ? 'dark' : 'light');
  }, [dark]);

  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const toggleLang = () => {
    const next = i18n.language === 'zh' ? 'en' : 'zh';
    void i18n.changeLanguage(next);
    localStorage.setItem('sciplot-lang', next);
  };

  return (
    <div
      className="flex items-center gap-3 px-3 h-12 border-b shrink-0"
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
    >
      {/* logo */}
      <div className="flex items-center gap-2">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="2" width="20" height="20" rx="5" fill="var(--color-accent)" />
          <path d="M6 16l4-5 3 2.5L18 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="18" cy="8" r="1.6" fill="#fff" />
        </svg>
        <div className="leading-tight">
          <div className="font-bold text-[13px]">{t('app.title')}</div>
          <div className="text-[9.5px]" style={{ color: 'var(--text-3)' }}>
            {t('app.subtitle')}
          </div>
        </div>
      </div>

      {/* mode switch */}
      <div className="flex rounded-lg p-0.5 ml-4" style={{ background: 'var(--bg-subtle)' }}>
        {(['chart', 'canvas'] as const).map((m) => (
          <button
            key={m}
            className="px-4 py-1 rounded-md text-[11.5px] font-medium cursor-pointer transition-colors"
            style={{
              background: mode === m ? 'var(--bg-panel)' : 'transparent',
              color: mode === m ? 'var(--text-1)' : 'var(--text-3)',
              boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
            }}
            onClick={() => setMode(m)}
          >
            {t(`mode.${m}`)}
          </button>
        ))}
      </div>

      {/* undo / redo */}
      <div className="flex items-center gap-0.5 ml-2">
        <button
          className="tool-btn"
          title={`${t('app.undo')} (Ctrl+Z)`}
          disabled={!canUndo}
          style={{ opacity: canUndo ? 1 : 0.35 }}
          onClick={undo}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
          </svg>
        </button>
        <button
          className="tool-btn"
          title={`${t('app.redo')} (Ctrl+Y)`}
          disabled={!canRedo}
          style={{ opacity: canRedo ? 1 : 0.35 }}
          onClick={redo}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 14l5-5-5-5" />
            <path d="M20 9H9.5a5.5 5.5 0 000 11H13" />
          </svg>
        </button>
      </div>

      <div className="flex-1" />

      <button className="btn !px-2.5" onClick={toggleLang} title="中文 / English">
        {i18n.language === 'zh' ? 'EN' : '中'}
      </button>
      <button className="btn !px-2.5" onClick={() => setDark(!dark)} title="Theme">
        {dark ? '☀' : '☾'}
      </button>
    </div>
  );
}
