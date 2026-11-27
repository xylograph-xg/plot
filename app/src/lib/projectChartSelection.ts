import type { ECharts } from 'echarts';
import type { ChartType, Dataset } from '../types';
import { containsPoint, type MeasurementSeries, type SelectedMeasurement, type SelectionRect } from './chartSelection';
import { visibleRowIndices } from './rowFilter';

type ProjectionModel = {
  getModel(): {
    getComponent(type: 'grid', index: number): { coordinateSystem?: { getRect(): SelectionRect } } | undefined;
    getSeriesByIndex(index: number): {
      coordinateSystem?: { dataToPoint(point: [number | string, number | string]): number[] };
      getData(): {
        getCalculationInfo(key: 'stackResultDimension'): string | undefined;
        get(dimension: string, index: number): number;
        getItemLayout(index: number): SelectionRect | undefined;
      };
    } | undefined;
  } | undefined;
};

export function chartPlotRect(inst: ECharts): SelectionRect | undefined {
  return (inst as unknown as ProjectionModel).getModel()?.getComponent('grid', 0)?.coordinateSystem?.getRect();
}

export function projectChartSelection(inst: ECharts, grid: SelectionRect, area: SelectionRect,
  measurements: MeasurementSeries[], datasets: Dataset[], legend: Record<string, boolean>, type: ChartType) {
  const rect = { x: grid.x + area.x * grid.width, y: grid.y + area.y * grid.height,
    width: area.width * grid.width, height: area.height * grid.height };
  const points: SelectedMeasurement[] = [];
  const model = (inst as unknown as ProjectionModel).getModel();
  const horizontal = type === 'barh';
  const bar = horizontal || type === 'bar';
  const sourceRows = new Map<string, number[]>();
  for (const { name, index, points: measurementsForSeries, datasetId } of measurements) {
    if (legend[name] === false) continue;
    const series = model?.getSeriesByIndex(index);
    const coordinates = series?.coordinateSystem;
    if (!series || !coordinates) continue;
    const data = series.getData();
    const stackDimension = data.getCalculationInfo('stackResultDimension');
    const dataset = datasets.find(({ id }) => id === datasetId);
    if (!dataset) continue;
    if (dataset.rowFilter && !sourceRows.has(datasetId)) sourceRows.set(datasetId, visibleRowIndices(dataset));
    const rows = sourceRows.get(datasetId);
    for (const { x, y, row, dataIndex } of measurementsForSeries()) {
      const stackValue = stackDimension ? data.get(stackDimension, dataIndex) : NaN;
      const coord: [number | string, number | string] = !Number.isFinite(stackValue) ? [x, y]
        : horizontal ? [stackValue, y] : [x, stackValue];
      const bounds = bar ? data.getItemLayout(dataIndex) : undefined;
      const [px, py] = bounds ? [bounds.x + (horizontal ? bounds.width : bounds.width / 2),
        bounds.y + (horizontal ? bounds.height / 2 : bounds.height)] : coordinates.dataToPoint(coord);
      if (!containsPoint(rect, px, py)) continue;
      points.push({ x, y, row: rows?.[row] ?? row, series: name, datasetId });
    }
  }
  return { rect, points };
}
