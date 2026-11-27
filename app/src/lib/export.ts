import { chartSvgRenderers } from './chartSvg';
import { saveAs } from 'file-saver';
import type { ProjectFile } from '../types';
import { validPlateauPoints } from './autoStart';
import { maxSpectrumPeaks, spectrumBaselines, spectrumShapes, validSpectrumParameters } from './spectrum';
import { spectralDirections } from './spectralAxis';
import type { AxisConfig, SpectrumFitConfig } from '../types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Compose the on-screen figure (ECharts SVG panels + annotation overlay SVG)
 * into a single standalone SVG document.
 */
export function composeFigureSvg(figureEl: HTMLElement, withResiduals = true): SVGSVGElement {
  const rootRect = figureEl.getBoundingClientRect();
  // The on-screen figure may be CSS-scaled (zoom); offsetWidth is the unscaled size.
  const scale = rootRect.width / figureEl.offsetWidth || 1;
  const W = Math.round(figureEl.offsetWidth);
  const main = figureEl.querySelector<HTMLElement>('[data-figure-main]');
  const H = Math.round(withResiduals ? figureEl.offsetHeight : (main?.offsetHeight ?? figureEl.offsetHeight));

  const out = document.createElementNS(SVG_NS, 'svg');
  out.setAttribute('xmlns', SVG_NS);
  out.setAttribute('width', String(W));
  out.setAttribute('height', String(H));
  out.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const accent = getComputedStyle(figureEl).getPropertyValue('--color-accent').trim();
  if (accent) out.style.setProperty('--color-accent', accent);

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(W));
  bg.setAttribute('height', String(H));
  bg.setAttribute('fill', '#ffffff');
  out.appendChild(bg);

  const append = (svg: SVGSVGElement, anchor: Element = svg) => {
    const r = anchor.getBoundingClientRect();
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute(
      'transform',
      `translate(${(r.left - rootRect.left) / scale}, ${(r.top - rootRect.top) / scale})`,
    );
    for (const attribute of ['font-family', 'font-size', 'fill', 'stroke']) {
      const value = svg.getAttribute(attribute);
      if (value !== null) g.setAttribute(attribute, value);
    }
    for (const child of Array.from(svg.childNodes)) {
      g.appendChild(child.cloneNode(true));
    }
    out.appendChild(g);
  };

  for (const panel of figureEl.querySelectorAll<HTMLElement>('[data-chart-panel]')) {
    const render = chartSvgRenderers.get(panel);
    if (render) append(render(), panel);
  }
  figureEl
    .querySelectorAll<SVGSVGElement>('svg[data-overlay]')
    .forEach((svg) => append(svg));
  if (withResiduals) {
    figureEl.querySelectorAll<SVGSVGElement>('svg[data-fit-residuals]').forEach((svg) => append(svg));
  }

  // strip interactive-only attributes
  out.querySelectorAll('[cursor]').forEach((el) => el.removeAttribute('cursor'));
  return out;
}

function svgToString(svg: SVGSVGElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
}

async function figurePng(svg: SVGSVGElement, dpi: number): Promise<Blob> {
  const W = Number(svg.getAttribute('width'));
  const H = Number(svg.getAttribute('height'));
  const scale = dpi / 96;

  const url = URL.createObjectURL(
    new Blob([svgToString(svg)], { type: 'image/svg+xml;charset=utf-8' }),
  );
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to rasterize SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Failed to encode PNG')), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function waitForFits(figure: HTMLElement) {
  if (!figure.querySelector('[data-fit-pending]')) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Timed out while waiting for fits'));
    }, 30_000);
    const observer = new MutationObserver(() => {
      if (figure.querySelector('[data-fit-pending]')) return;
      clearTimeout(timer);
      observer.disconnect();
      requestAnimationFrame(() => resolve());
    });
    observer.observe(figure, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-fit-pending'] });
  });
}

export async function downloadFigure(figureEl: HTMLElement, filename: string, dpi: number) {
  await waitForFits(figureEl);
  const figures = [{ svg: composeFigureSvg(figureEl, false), name: filename }];
  if (figureEl.querySelector('svg[data-fit-residuals]')) {
    figures.push({ svg: composeFigureSvg(figureEl), name: `${filename}-residuals` });
  }
  const files: { blob: Blob; name: string }[] = [];
  for (const { svg, name } of figures) {
    files.push({ blob: await figurePng(svg, dpi), name: `${name}.png` });
  }
  for (const { blob, name } of files) saveAs(blob, name);
}

export function saveProjectFile(project: ProjectFile) {
  const blob = new Blob([JSON.stringify(project, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  saveAs(blob, 'sciplot-project.json');
}

export async function readProjectFile(file: File): Promise<ProjectFile> {
  return parseProject(await file.text());
}

export function parseProject(text: string): ProjectFile {
  const data = JSON.parse(text) as ProjectFile;
  if (data?.app !== 'sciplot' || ![1, 2, 3].includes(data.version) ||
      !Array.isArray(data.datasets) || !Array.isArray(data.charts)) {
    throw new Error('Unsupported SciPlot project file');
  }
  for (const chart of data.charts) {
    if (!chart || (chart.title != null && typeof chart.title !== 'string') ||
        (chart.series != null && (!Array.isArray(chart.series) || chart.series.some((series) => !series)))) {
      throw new Error('Invalid chart');
    }
    const legacy = chart as typeof chart & { spectrumFit?: SpectrumFitConfig };
    const fits = chart.spectrumFits ?? (legacy.spectrumFit ? [legacy.spectrumFit] : []);
    if (!Array.isArray(fits) || fits.some((fit) => !fit || typeof fit.seriesId !== 'string' || (fit.group !== undefined && typeof fit.group !== 'string') ||
        (fit.baseline !== undefined && !spectrumBaselines.includes(fit.baseline)) ||
        !spectrumShapes.includes(fit.shape) || !Number.isInteger(fit.count) || fit.count < 1 || fit.count > maxSpectrumPeaks ||
        (fit.centers !== undefined && (!Array.isArray(fit.centers) ||
          fit.centers.length !== fit.count || !fit.centers.every(Number.isFinite))) ||
        (fit.adjustments !== undefined && (!fit.adjustments || typeof fit.adjustments !== 'object' ||
          Array.isArray(fit.adjustments) || Object.values(fit.adjustments).some((value) =>
            !validSpectrumParameters(fit.shape, fit.count, value)))))) {
      throw new Error('Invalid spectrum fit');
    }
    if (legacy.spectrumFit !== undefined) {
      chart.spectrumFits = fits;
      delete legacy.spectrumFit;
    }
    const spectral = chart.spectralAxis;
    const validAxis = (axis?: Pick<AxisConfig, 'label' | 'min' | 'max'>) =>
      axis && [axis.label, axis.min, axis.max].every((value) => typeof value === 'string');
    if (spectral && (!spectralDirections.includes(spectral.direction) || typeof spectral.density !== 'boolean' ||
      !validAxis(spectral.originalX) || (spectral.originalY && !validAxis(spectral.originalY)) ||
      (spectral.originalY2 && !validAxis(spectral.originalY2)))) {
      throw new Error('Invalid spectral axis conversion');
    }
    const preference = chart.spectralAxisPreference;
    if (preference && (!spectralDirections.includes(preference.direction) || typeof preference.density !== 'boolean')) {
      throw new Error('Invalid spectral axis preference');
    }
  }
  for (const dataset of data.datasets) {
    if (!Array.isArray(dataset?.columns) || !Array.isArray(dataset.rows)) {
      throw new Error('Invalid dataset');
    }
    const { first, last, condition, autoStart } = dataset.rowFilter ?? {};
    for (const bound of [first, last]) {
      if (bound !== undefined && (!Number.isSafeInteger(bound) || bound < 1)) {
        throw new Error('Invalid row bounds');
      }
    }
    if (condition && (!Number.isInteger(condition.column) || condition.column < 0 ||
        condition.column >= dataset.columns.length ||
        !['equals', 'contains', 'gte', 'lte', 'empty'].includes(condition.operator) ||
        typeof condition.value !== 'string')) {
      throw new Error('Invalid row condition');
    }
    if (autoStart && (first === undefined || !Number.isInteger(autoStart.column) || autoStart.column < 0 ||
        autoStart.column >= dataset.columns.length || !validPlateauPoints(autoStart.plateauPoints) ||
        (autoStart.mode !== undefined && autoStart.mode !== 'drop' && autoStart.mode !== 'rise'))) {
      throw new Error('Invalid detected start row');
    }
  }
  return data;
}
