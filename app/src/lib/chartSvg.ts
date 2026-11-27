import { init, type EChartsOption } from 'echarts';

type RenderSvg = () => SVGSVGElement;
export const chartSvgRenderers = new WeakMap<HTMLElement, RenderSvg>();

export function renderChartSvg(option: EChartsOption, width: number, height: number): SVGSVGElement {
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width, height });
  try {
    chart.setOption(option);
    const parsed = new DOMParser().parseFromString(chart.renderToSVGString(), 'image/svg+xml');
    if (parsed.documentElement.localName !== 'svg') throw new Error('Could not render chart SVG');
    return parsed.documentElement as unknown as SVGSVGElement;
  } finally {
    chart.dispose();
  }
}
