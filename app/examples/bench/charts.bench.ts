import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { init } from 'echarts';
import { buildChartOption } from '../../src/lib/echartsOption';
import { datasetFromTable, inspectDelimitedText, numericColumnIndices } from '../../src/lib/parse';
import { calculateTrendline } from '../../src/lib/trendline';
import { resolveSeries } from '../../src/lib/xySeries';
import { defaultChart, defaultSeries, useStore } from '../../src/store/useStore';

function example(count: number) {
  const text = readFileSync(new URL(`./${count}x10.csv`, import.meta.url), 'utf8');
  return { text, dataset: datasetFromTable(inspectDelimitedText(text, 'bench', true), 'bench') };
}

const large = example(100_000);
const medium = example(10_000);
const heatmap = example(15_000);
const mapping = defaultSeries('bench');
const chart = { ...defaultChart(), type: 'heatmap' as const, series: [mapping] };
const series = resolveSeries(mapping, [large.dataset])[0];
useStore.getState().openLocalDataset(large.dataset);

test('Data and drawing', async ({ bench }) => {
  let edit = 0;
  const vectorChart = { ...chart, type: 'line' as const,
    series: [{ ...mapping, trendline: 'none' as const }] };
  const vectorOption = buildChartOption(vectorChart, [medium.dataset]);
  const benchmarks = [
    bench('CSV import 10,000 × 10', () => { datasetFromTable(inspectDelimitedText(medium.text, 'bench', true), 'bench'); }),
    bench('CSV import 100,000 × 10', () => { datasetFromTable(inspectDelimitedText(large.text, 'bench', true), 'bench'); }),
    bench('Numeric columns 100,000 × 10', () => { numericColumnIndices(large.dataset); }),
    bench('Heatmap options 15,000 × 10', () => { buildChartOption(chart, [heatmap.dataset]); }),
    bench('Double exponential with full residuals, 50,000 points', () => {
      calculateTrendline(chart, { ...series, points: series.points.slice(0, 50_000) }, 'doubleExponential');
    }),
    bench('Edit and undo a point in 100,000 × 10', () => {
      useStore.getState().updateCells('bench', 3, new Map([[0, ++edit], [1, edit]]));
      useStore.temporal.undo();
    }),
    bench('Render SVG for export, 10,000 points', () => {
      const renderer = init(null, undefined, { renderer: 'svg', ssr: true, width: 454, height: 340 });
      try {
        renderer.setOption(vectorOption);
        renderer.renderToSVGString();
      } finally {
        renderer.dispose();
      }
    }),
  ];
  await bench.compare(...benchmarks, { time: 300, iterations: 12, warmupTime: 150, warmupIterations: 4 });
});
