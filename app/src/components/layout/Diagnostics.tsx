import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { clearDiagnostic, getDiagnostic, subscribeToDiagnostics } from '../../lib/diagnostics';

export function Diagnostics() {
  const { t } = useTranslation();
  const error = useSyncExternalStore(subscribeToDiagnostics, getDiagnostic);
  if (!error) return null;
  return (
    <aside className="fixed bottom-3 right-3 z-50 max-w-[min(32rem,90vw)] rounded border border-(--border) bg-(--bg-panel) px-3 py-2 shadow-lg">
      <div className="flex items-start gap-3">
        <details className="min-w-0 flex-1">
          <summary className="cursor-pointer text-xs">{t('diagnostics.details')}</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px]">{error.context}{'\n'}{error.detail}</pre>
        </details>
        <button className="btn !py-0" onClick={clearDiagnostic}>{t('diagnostics.dismiss')}</button>
      </div>
    </aside>
  );
}
