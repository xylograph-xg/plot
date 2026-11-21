import { useTranslation } from 'react-i18next';
import type { AutoStartMode } from '../../types';

export function AutoStartSelect({ value, onChange, allowNone = false }: {
  value: AutoStartMode | '';
  onChange: (mode: AutoStartMode | '') => void;
  allowNone?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <select className="input min-w-0" aria-label={t('autoStart.mode')} value={value}
      onChange={(event) => onChange(event.target.value as AutoStartMode | '')}>
      {allowNone && <option value="">{t('autoStart.off')}</option>}
      <option value="drop">{t('autoStart.drop')}</option>
      <option value="rise">{t('autoStart.rise')}</option>
    </select>
  );
}
