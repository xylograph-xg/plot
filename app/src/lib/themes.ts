/** Visual theme presets that control the overall look of a chart. */

export interface ChartTheme {
  id: string;
  name: string;
  background: string;
  textColor: string;
  axisColor: string;
  gridColor: string;
  gridType: 'solid' | 'dashed';
  /** Hide axis lines entirely and rely on grid (minimal style). */
  hideAxisLine: boolean;
}

export const THEMES: ChartTheme[] = [
  {
    id: 'publication',
    name: 'Publication',
    background: '#ffffff',
    textColor: '#1a1d23',
    axisColor: '#1a1d23',
    gridColor: '#e0e0e0',
    gridType: 'dashed',
    hideAxisLine: false,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    background: '#ffffff',
    textColor: '#37352f',
    axisColor: '#9b9a97',
    gridColor: '#ededec',
    gridType: 'solid',
    hideAxisLine: false,
  },
  {
    id: 'ggplot',
    name: 'ggplot2',
    background: '#ebebeb',
    textColor: '#2b2b2b',
    axisColor: '#2b2b2b',
    gridColor: '#ffffff',
    gridType: 'solid',
    hideAxisLine: true,
  },
  {
    id: 'seaborn',
    name: 'Seaborn',
    background: '#eaeaf2',
    textColor: '#262626',
    axisColor: '#262626',
    gridColor: '#ffffff',
    gridType: 'solid',
    hideAxisLine: true,
  },
  {
    id: 'dark',
    name: 'Dark',
    background: '#1c1e26',
    textColor: '#e8eaee',
    axisColor: '#a8aeb9',
    gridColor: '#33363f',
    gridType: 'solid',
    hideAxisLine: false,
  },
];

export function getTheme(id: string): ChartTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
