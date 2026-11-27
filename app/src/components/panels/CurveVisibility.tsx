import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { datasetView } from '../../lib/rowFilter';
import { isCurveVisible, resolveSeries } from '../../lib/xySeries';
import { useStore } from '../../store/useStore';
import type { ChartConfig, Dataset } from '../../types';

export function CurveVisibility({ chart, datasets }: { chart: ChartConfig; datasets: Dataset[] }) {
  const { t } = useTranslation();
  const curves = useMemo(() => {
    const ids = new Set(chart.series.map(({ datasetId }) => datasetId));
    const views = datasets.filter(({ id }) => ids.has(id)).map(datasetView);
    return chart.series.flatMap((mapping) => resolveSeries(mapping, views)).filter(({ points }) => points.length > 0);
  }, [chart.series, datasets]);
  if (curves.length < 2 && curves.every(isCurveVisible)) return null;

  return (
    <fieldset>
      <legend className="label">{t('chart.visibleCurves')}</legend>
      <div className="flex flex-wrap gap-1">
        {curves.map((curve) => {
          const { sid, name, mapping } = curve;
          const shown = isCurveVisible(curve);
          const duplicate = curves.some((other) => other.sid !== sid && other.name === name);
          const source = duplicate && datasets.find(({ id }) => id === mapping.datasetId);
          const label = source ? `${name} · ${source.name}` : name;
          return (
            <button key={sid} type="button" className="btn max-w-full truncate !px-1.5 text-(--text-3) aria-pressed:!border-accent aria-pressed:!text-accent"
              aria-pressed={shown} title={label} onClick={() => {
                const groups = mapping.hiddenGroups ?? [];
                useStore.getState().updateSeries(chart.id, mapping.id, mapping.groupCol >= 0
                  ? { hiddenGroups: shown ? [...groups, name] : groups.filter((group) => group !== name) }
                  : { hidden: shown });
              }}>{label}</button>
          );
        })}
      </div>
    </fieldset>
  );
}
