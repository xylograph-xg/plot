const onLight = ['#ad214d', '#6137b0', '#00746b', '#9a4b02', '#254cad', '#407528', '#9c278f', '#414854'];
const onDark = ['#ff83b4', '#c9a7ff', '#5fe0c9', '#ffbb69', '#81aaff', '#a7da74', '#ec9de8', '#d5deec'];

function rgb(color: string): number[] | undefined {
  const hex = color.slice(1);
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) return;
  const expanded = hex.length === 3 ? [...hex].map((value) => value + value).join('') : hex;
  return [0, 2, 4].map((start) => Number.parseInt(expanded.slice(start, start + 2), 16));
}

export function chooseFitColor(source: string, rawColors: string[], used: Set<string>, dark: boolean): string {
  const palette = dark ? onDark : onLight;
  const original = rgb(source);
  const distinct = (color: string) => {
    const candidate = rgb(color)!;
    return color !== source.toLowerCase() && (!original || candidate.some((value, channel) => value !== original[channel]));
  };
  const available = palette.filter(distinct);
  const avoid = new Set(rawColors.map((color) => rgb(color)?.join(':') ?? color.toLowerCase()));
  const unused = (color: string) => !used.has(color);
  const candidates = available.filter((color) => unused(color) && !avoid.has(rgb(color)!.join(':')));
  const options = candidates.length ? candidates : available.filter(unused);
  const references = [...new Set([...rawColors, ...used])].map(rgb).filter((value) => value !== undefined);
  const distance = (color: string) => {
    const candidate = rgb(color)!;
    return references.reduce((nearest, reference) => Math.min(nearest,
      candidate.reduce((sum, value, channel) => sum + (value - reference[channel]) ** 2, 0)), Infinity);
  };
  return (options.length ? options : available).reduce((best, color) =>
    distance(color) > distance(best) ? color : best);
}
