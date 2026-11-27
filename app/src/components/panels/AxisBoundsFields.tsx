import { useTranslation } from 'react-i18next';
import { axisBounds } from '../../lib/axisBounds';
import type { AxisConfig } from '../../types';

export interface AxisBoundsProps {
  axis: AxisConfig;
  onChange(patch: Partial<AxisConfig>): void;
}

export function AxisBoundsFields({ axis, onChange, compact = false }: AxisBoundsProps & { compact?: boolean }) {
  const { t } = useTranslation();
  const { invalid } = axisBounds(axis);
  return (['min', 'max'] as const).map((field) => {
    const label = t(`style.${field}`);
    const input = <input key={field} className="input min-w-0" aria-label={label}
      aria-invalid={invalid} placeholder={compact ? label : t('style.auto')} value={axis[field]}
      onChange={(event) => onChange({ [field]: event.target.value })} />;
    return compact ? input : <label key={field}><span className="label">{label}</span>{input}</label>;
  });
}

export function AxisBoundsError({ axis, className = '' }: { axis: AxisConfig; className?: string }) {
  const { t } = useTranslation();
  if (!axisBounds(axis).invalid) return null;
  return <p role="alert" className={`text-[11px] text-red-500 ${className}`}>{t('style.invalidBounds')}</p>;
}

export function QuickAxis({ label, axis, onChange }: AxisBoundsProps & { label: string }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-[2.6rem_1fr_1fr] items-center gap-1.5">
      <span className="text-[11px] font-medium">{label}</span>
      <AxisBoundsFields axis={axis} onChange={onChange} compact />
      <AxisBoundsError axis={axis} className="col-span-3" />
    </div>
  );
}
