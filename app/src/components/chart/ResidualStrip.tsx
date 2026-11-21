import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartConfig } from '../../types';
import { fitNumber } from '../../lib/fitResultText';
import type { FitResidualSeries, ResidualPlot } from '../../lib/residuals';
import { getTheme } from '../../lib/themes';

export const residualStripHeight = 94;

function limitFor(series: FitResidualSeries[]): number {
  let abs = 0;
  for (const item of series) {
    for (const [, value] of item.points) abs = Math.max(abs, Math.abs(value));
  }
  if (abs === 0) return 0;
  const unit = 10 ** Math.floor(Math.log10(abs));
  return (Math.ceil(abs / unit) * unit) || abs;
}

export function ResidualStrip({ plot, chart, width, panel }: {
  plot: ResidualPlot;
  chart: ChartConfig;
  width: number;
  panel?: string;
}) {
  const { t } = useTranslation();
  const clip = useId();
  const { left, right, xAt } = plot;
  const theme = getTheme(chart.style.theme);
  const fontSize = Math.max(8, Math.min(10, chart.style.fontSize));
  const primary = plot.series.filter((item) => !item.rightAxis);
  const secondary = plot.series.filter((item) => item.rightAxis);
  const [mainLimit, rightLimit] = [limitFor(primary), limitFor(secondary)];
  const top = 23;
  const bottom = 84;
  const center = (top + bottom) / 2;
  const halfHeight = (bottom - top) / 2;
  const title = panel ? `${panel} · ${t('fit.residuals')}` : t('fit.residuals');
  const yAt = (value: number, limit: number) => limit === 0 ? center : center - (value / limit) * (halfHeight - 3);

  const ticks = (limit: number, y2: boolean) => {
    const x = y2 ? right : left;
    const outside = y2 ? width - x >= 31 : x >= 31;
    const labelOnRight = y2 === outside;
    const delta = labelOnRight ? 4 : -4;
    return (limit ? [-limit, 0, limit] : [0]).map((value) => {
      const y = yAt(value, limit);
      return (
        <g key={value}>
          <line x1={x} x2={x + (y2 ? 2 : -2)} y1={y} y2={y} stroke={theme.axisColor} />
          <text x={x + delta} y={y + 3} textAnchor={labelOnRight ? 'start' : 'end'}>
            {fitNumber(value, 3)}
          </text>
        </g>
      );
    });
  };

  return (
    <svg data-fit-residuals="true" width={width} height={residualStripHeight}
      viewBox={`0 0 ${width} ${residualStripHeight}`} className="block"
      fontFamily={chart.style.fontFamily} fontSize={fontSize} fill={theme.textColor}
      role="img" aria-label={title}>
      <title>{t('fit.residualHint')}</title>
      <rect width={width} height={residualStripHeight} fill={theme.background} />
      <text x={left} y={15} fontWeight={600}>{title}</text>
      {secondary.length > 0 && <text x={right} y={15} textAnchor="end">Y₂</text>}
      <line x1={left} x2={right} y1={center} y2={center} stroke={theme.axisColor} strokeDasharray="3 3" />
      {primary.length > 0 && <>
        <line x1={left} x2={left} y1={top} y2={bottom} stroke={theme.axisColor} />
        {ticks(mainLimit, false)}
      </>}
      {secondary.length > 0 && <>
        <line x1={right} x2={right} y1={top} y2={bottom} stroke={theme.axisColor} />
        {ticks(rightLimit, true)}
      </>}
      <defs>
        <clipPath id={clip}><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {plot.series.map((item) => {
          const limit = item.rightAxis ? rightLimit : mainLimit;
          const dots = item.points.map(([x, value]) =>
            `M${xAt(x).toFixed(2)} ${yAt(value, limit).toFixed(2)}h.02`).join('');
          return (
            <path key={item.id} data-residual-series={item.id} d={dots} fill="none" stroke={item.color}
              strokeWidth={2.5} strokeOpacity={0.82} strokeLinecap="round">
              <title>{item.name}</title>
            </path>
          );
        })}
      </g>
    </svg>
  );
}
