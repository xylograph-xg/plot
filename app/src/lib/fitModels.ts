import type { FitModelKind } from '../types';
import { fitShape, leastSquares } from './fitLeastSquares';
import { linearRegression } from './stats';

type FitGroup = 'polynomial' | 'exponentials' | 'transforms' | 'peaks' | 'sigmoid' | 'periodic';
type Domain = 'positive' | 'nonnegative' | 'nonzero';

interface Model {
  group: FitGroup;
  minimum: number;
  domain?: Domain;
}

export const fitModels: Record<FitModelKind, Model> = {
  linear: { group: 'polynomial', minimum: 2 },
  quadratic: { group: 'polynomial', minimum: 3 },
  cubic: { group: 'polynomial', minimum: 4 },
  quartic: { group: 'polynomial', minimum: 5 },
  quintic: { group: 'polynomial', minimum: 6 },
  exponential: { group: 'exponentials', minimum: 2 },
  exponentialGrowth: { group: 'exponentials', minimum: 3 },
  exponentialDecay: { group: 'exponentials', minimum: 3 },
  doubleExponential: { group: 'exponentials', minimum: 4 },
  doubleExponentialDecay: { group: 'exponentials', minimum: 5 },
  logarithmic: { group: 'transforms', minimum: 2, domain: 'positive' },
  power: { group: 'transforms', minimum: 2, domain: 'positive' },
  squareRoot: { group: 'transforms', minimum: 2, domain: 'nonnegative' },
  reciprocal: { group: 'transforms', minimum: 2, domain: 'nonzero' },
  gaussian: { group: 'peaks', minimum: 4 },
  lorentzian: { group: 'peaks', minimum: 4 },
  logistic: { group: 'sigmoid', minimum: 4 },
  hill: { group: 'sigmoid', minimum: 4, domain: 'nonnegative' },
  sinusoidal: { group: 'periodic', minimum: 5 },
};

export const fitGroups: FitGroup[] = ['polynomial', 'exponentials', 'transforms', 'peaks', 'sigmoid', 'periodic'];

export function isFitModel(kind: string): kind is FitModelKind {
  return Object.hasOwn(fitModels, kind);
}

export function inFitDomain(kind: FitModelKind, x: number): boolean {
  switch (fitModels[kind].domain) {
    case 'positive': return x > 0;
    case 'nonnegative': return x >= 0;
    case 'nonzero': return x !== 0;
    default: return true;
  }
}

interface Parameter {
  symbol: string;
  value: number;
}

interface FitEquation {
  equation: string;
  parameters: Parameter[];
  predict: (x: number) => number;
}

export interface CurveFit extends FitEquation {
  r2: number | null;
}

interface FitData {
  xs: number[];
  y: number[];
  min: number;
  max: number;
  span: number;
  x: number[];
  unitX: (x: number) => number;
  restore: (y: number) => number;
  amplitude: (y: number) => number;
  project: (columns: number[][], baseline?: boolean) => ReturnType<typeof leastSquares>;
}

function parameter(symbol: string, value: number): Parameter {
  return { symbol, value };
}

function makeFitData(xs: number[], ys: number[], baseline: boolean): FitData | null {
  const [min, max] = xs.reduce(([lo, hi], x) => [Math.min(lo, x), Math.max(hi, x)], [Infinity, -Infinity]);
  const span = max - min;
  if (span <= 0 || !Number.isFinite(span)) return null;
  const offset = baseline ? ys[0] : 0;
  const scale = ys.reduce((largest, y) => Math.max(largest, Math.abs(y - offset)), 0) || 1;
  if (!Number.isFinite(scale)) return null;
  const unitX = (x: number) => (x - min) / span;
  const y = ys.map((value) => (value - offset) / scale);
  const constant = new Float64Array(xs.length).fill(1);
  return {
    xs, y, min, max, span, unitX,
    x: xs.map(unitX),
    restore: (value) => offset + scale * value,
    amplitude: (value) => scale * value,
    project: (columns, withBaseline = true) => leastSquares(withBaseline ? [constant, ...columns] : columns, y),
  };
}

const subscripts = ['₀', '₁', '₂', '₃', '₄', '₅'];

function polynomial(data: FitData, degree: number): FitEquation | undefined {
  const center = data.min + data.span / 2;
  const scale = data.span / 2;
  const norm = (x: number) => (x - center) / scale;
  const normalized = data.xs.map(norm);
  const basis = Array.from({ length: degree }, (_, index) => normalized.map((x) => x ** (index + 1)));
  const solution = data.project(basis);
  if (!solution) return;
  const coefficients = solution.coefficients;
  const terms = coefficients.slice(1).map((_, index) =>
    `a${subscripts[index + 1]}t${['', '²', '³', '⁴', '⁵'][index]}`);
  return {
    equation: `y = a₀ + ${terms.join(' + ')}\nt = (x − x₀)/s`,
    parameters: [
      ...coefficients.map((value, index) => parameter(`a${subscripts[index]}`, index === 0 ? data.restore(value) : data.amplitude(value))),
      parameter('x₀', center), parameter('s', scale),
    ],
    predict: (x) => data.restore(coefficients.reduceRight((y, value) => y * norm(x) + value, 0)),
  };
}

function logRatio(x: number, base: number): number {
  return Math.abs(x - base) < base / 2 ? Math.log1p((x - base) / base) : Math.log(x) - Math.log(base);
}

function transformed(data: FitData, kind: 'logarithmic' | 'reciprocal' | 'squareRoot'): FitEquation | undefined {
  const log = kind === 'logarithmic';
  const reciprocal = kind === 'reciprocal';
  const scale = reciprocal ? data.xs.reduce((min, x) => Math.min(min, Math.abs(x)), Infinity) : Math.sqrt(data.max);
  const transform = log ? (x: number) => logRatio(x, data.min)
    : reciprocal ? (x: number) => scale / x
      : (x: number) => Math.sqrt(x) / scale;
  const fit = linearRegression(data.xs.map(transform), data.y);
  if (!fit) return;
  const amplitude = data.amplitude(fit.slope);
  const parameters = [
    parameter('a', log ? amplitude : reciprocal ? amplitude * scale : amplitude / scale),
    parameter('b', data.restore(fit.intercept)),
  ];
  if (log) parameters.push(parameter('x₀', data.min));
  return {
    equation: log ? 'y = a ln(x/x₀) + b' : reciprocal ? 'y = a/x + b' : 'y = a√x + b',
    parameters,
    predict: (x) => data.restore(fit.yMean + fit.slope * (transform(x) - fit.xMean)),
  };
}

const logRates = { min: Math.log(1e-4), max: Math.log(2048), steps: 20 };

function exponential(data: FitData, kind: 'exponential' | 'exponentialGrowth' | 'exponentialDecay' | 'power'): FitEquation | undefined {
  const power = kind === 'power';
  const baseline = kind === 'exponentialGrowth' || kind === 'exponentialDecay';
  const span = power ? logRatio(data.max, data.min) : data.span;
  if (span <= 0 || !Number.isFinite(span)) return;
  const directions = baseline ? [kind === 'exponentialGrowth' ? 1 : -1] : [-1, 1];
  const candidates = directions.flatMap((direction) => {
    const anchor = direction > 0 ? data.max : data.min;
    const time = power ? (x: number) => logRatio(x, anchor) / span : (x: number) => (x - anchor) / span;
    const timeValues = data.xs.map(time);
    const profile = (t: number, rate: number) => Math.exp(direction * rate * t);
    const optimum = fitShape([logRates], ([logRate]) =>
      data.project([timeValues.map((t) => profile(t, Math.exp(logRate)))], baseline));
    if (!optimum) return [];
    if (!baseline) {
      const constant = data.project([timeValues.map(() => 1)], false);
      if (constant && constant.error < optimum.error) {
        return [{ rate: 0, anchor, time, profile, ...constant }];
      }
    }
    return [{ rate: Math.exp(optimum.shape[0]), anchor, time, profile, ...optimum }];
  });
  const best = candidates.sort((a, b) => a.error - b.error)[0];
  if (!best) return;
  const [c, a] = baseline ? best.coefficients : [0, best.coefficients[0]];
  const exponent = (best.anchor === data.max ? 1 : -1) * best.rate / span;
  const parameters = [
    parameter('a', data.amplitude(a)), parameter(baseline ? 'k' : 'b', baseline ? Math.abs(exponent) : exponent),
    parameter('x₀', best.anchor),
  ];
  if (baseline) parameters.push(parameter('c', data.restore(c)));
  const exponentialEquation = baseline
    ? `y = c + a exp[${kind === 'exponentialDecay' ? '−' : ''}k(x − x₀)]`
    : 'y = a exp[b(x − x₀)]';
  return {
    equation: power ? 'y = a(x/x₀)ᵇ' : exponentialEquation,
    parameters,
    predict: (x) => data.restore(c + a * best.profile(best.time(x), best.rate)),
  };
}

function doubleExponential(data: FitData, baseline: boolean): FitEquation | undefined {
  const profile = (t: number, rate: number) => Math.exp(rate * (rate > 0 ? t - 1 : t));
  const ranges = [{ ...logRates, steps: 11 }, { ...logRates, steps: 11 }];
  const signs = baseline ? [[-1, -1]] : [[-1, -1], [-1, 1], [1, 1]];
  const candidates = signs.flatMap(([first, second]) => {
    const optimum = fitShape(ranges, ([left, right]) => {
      if (first === second && right - left <= 0.01) return null;
      const b1 = first * Math.exp(left);
      const b2 = second * Math.exp(right);
      return data.project([data.x.map((x) => profile(x, b1)), data.x.map((x) => profile(x, b2))], baseline);
    });
    return optimum ? [{ ...optimum, rates: [first * Math.exp(optimum.shape[0]), second * Math.exp(optimum.shape[1])] }] : [];
  });
  const best = candidates.sort((left, right) => left.error - right.error)[0];
  if (!best) return;
  const [b1, b2] = best.rates;
  const [c, a1, a2] = baseline ? best.coefficients : [0, ...best.coefficients];
  return {
    equation: baseline ? 'y = c + a₁ exp(−k₁t) + a₂ exp(−k₂t)\nt = x − x₀'
      : 'y = a₁ exp[b₁(x − x₁)] + a₂ exp[b₂(x − x₂)]',
    parameters: baseline ? [
      parameter('c', data.restore(c)), parameter('a₁', data.amplitude(a1)), parameter('a₂', data.amplitude(a2)),
      parameter('k₁', -b1 / data.span), parameter('k₂', -b2 / data.span), parameter('x₀', data.min),
    ] : [
      parameter('a₁', data.amplitude(a1)), parameter('a₂', data.amplitude(a2)),
      parameter('b₁', b1 / data.span), parameter('b₂', b2 / data.span),
      parameter('x₁', b1 > 0 ? data.max : data.min), parameter('x₂', b2 > 0 ? data.max : data.min),
    ],
    predict: (x) => {
      const t = data.unitX(x);
      return data.restore(c + a1 * profile(t, b1) + a2 * profile(t, b2));
    },
  };
}

const centers = { min: -0.5, max: 1.5, steps: 12 };
const logWidths = { min: Math.log(0.001), max: Math.log(4), steps: 12 };
const logisticProfile = (x: number) => 1 / (1 + Math.exp(-x));

function peakOrSigmoid(data: FitData, kind: 'gaussian' | 'lorentzian' | 'logistic' | 'hill'): FitEquation | undefined {
  const hill = kind === 'hill';
  const sigmoid = hill || kind === 'logistic';
  const positiveMin = hill ? data.xs.reduce((min, x) => x > 0 ? Math.min(min, x) : min, Infinity) : data.min;
  const span = hill ? logRatio(data.max, positiveMin) : data.span;
  if (span <= 0 || !Number.isFinite(span)) return;
  const transform = hill ? (x: number) => logRatio(x, positiveMin) / span : data.unitX;
  const values = hill ? data.xs.map(transform) : data.x;
  const profile = sigmoid ? logisticProfile : kind === 'gaussian'
    ? (x: number) => Math.exp(-0.5 * x * x)
    : (x: number) => 1 / (1 + x * x);
  const minIndex = data.y.reduce((min, value, index) => value < data.y[min] ? index : min, 0);
  const maxIndex = data.y.reduce((max, value, index) => value > data.y[max] ? index : max, 0);
  const seeds = [values[minIndex], values[maxIndex]].filter(Number.isFinite)
    .flatMap((center) => [0.02, 0.1, 0.5].map((width) => [center, Math.log(width)]));
  const optimum = fitShape([centers, logWidths], ([center, logWidth]) => {
    const width = Math.exp(logWidth);
    return data.project([values.map((x) => profile((x - center) / width))]);
  }, seeds);
  if (!optimum) return;
  const [center, logWidth] = optimum.shape;
  const width = Math.exp(logWidth);
  const [c, a] = optimum.coefficients;
  const x0 = hill ? Math.exp(Math.log(positiveMin) + center * span) : data.min + center * span;
  const shape = sigmoid ? 1 / (width * span) : width * span;
  const parameters = [parameter('c', data.restore(c)), parameter('a', data.amplitude(a))];
  if (hill) parameters.push(parameter('K', x0), parameter('n', shape));
  else parameters.push(parameter('x₀', x0), parameter(sigmoid ? 'k' : kind === 'gaussian' ? 'σ' : 'γ', shape));
  const equations = {
    gaussian: 'y = c + a exp[−½((x − x₀)/σ)²]',
    lorentzian: 'y = c + a / [1 + ((x − x₀)/γ)²]',
    logistic: 'y = c + a / [1 + exp(−k(x − x₀))]',
    hill: 'y = c + a xⁿ / (Kⁿ + xⁿ)',
  };
  return {
    equation: equations[kind], parameters,
    predict: (x) => data.restore(c + a * profile((transform(x) - center) / width)),
  };
}

function sinusoidal(data: FitData): FitEquation | undefined {
  const sorted = [...new Set(data.x)].sort((a, b) => a - b);
  const spacings = sorted.slice(1).map((x, index) => x - sorted[index]).sort((a, b) => a - b);
  const max = Math.min(32, 0.5 / spacings[Math.floor(spacings.length / 2)]);
  const tau = 2 * Math.PI;
  const optimum = fitShape([{ min: 0.1, max, steps: Math.min(160, Math.max(12, Math.ceil(max * 10))) }], ([cycles]) => {
    const angles = data.x.map((x) => tau * cycles * x);
    return data.project([angles.map(Math.sin), angles.map(Math.cos)]);
  });
  if (!optimum) return;
  const cycles = optimum.shape[0];
  const [c, s, q] = optimum.coefficients;
  const a = Math.hypot(s, q);
  const phi = Math.atan2(q, s);
  return {
    equation: 'y = c + a sin[2πf(x − x₀) + φ]',
    parameters: [
      parameter('c', data.restore(c)), parameter('a', data.amplitude(a)), parameter('f', cycles / data.span),
      parameter('x₀', data.min), parameter('φ', phi),
    ],
    predict: (x) => data.restore(c + a * Math.sin(tau * cycles * data.unitX(x) + phi)),
  };
}

export function fitCurve(
  kind: FitModelKind, xs: number[], ys: number[], optimization?: { xs: number[]; ys: number[] },
): CurveFit | undefined {
  if (xs.length !== ys.length || xs.length < fitModels[kind].minimum) return;
  const baseline = kind !== 'power' && kind !== 'exponential' && kind !== 'doubleExponential';
  const data = makeFitData(optimization?.xs ?? xs, optimization?.ys ?? ys, baseline);
  if (!data) return;
  if (baseline && fitModels[kind].group !== 'polynomial' && fitModels[kind].group !== 'transforms' &&
      data.y.every((value) => value === 0)) return;
  const fit = (() => {
    switch (kind) {
      case 'linear': {
        const linear = linearRegression(data.xs, data.y);
        if (!linear) return;
        return {
          equation: 'y = ax + b',
          parameters: [parameter('a', data.amplitude(linear.slope)), parameter('b', data.restore(linear.intercept))],
          predict: (x: number) => data.restore(linear.yMean + linear.slope * (x - linear.xMean)),
        };
      }
      case 'quadratic': case 'cubic': case 'quartic': case 'quintic':
        return polynomial(data, fitModels[kind].minimum - 1);
      case 'logarithmic': case 'reciprocal': case 'squareRoot':
        return transformed(data, kind);
      case 'exponential': case 'exponentialGrowth': case 'exponentialDecay': case 'power':
        return exponential(data, kind);
      case 'doubleExponential': case 'doubleExponentialDecay':
        return doubleExponential(data, kind === 'doubleExponentialDecay');
      case 'gaussian': case 'lorentzian': case 'logistic': case 'hill': return peakOrSigmoid(data, kind);
      case 'sinusoidal': return sinusoidal(data);
    }
  })();
  if (!fit || fit.parameters.some(({ value }) => !Number.isFinite(value))) return;
  const scale = ys.reduce((max, y) => Math.max(max, Math.abs(y - ys[0])), 0) || 1;
  const normalized = ys.map((y) => (y - ys[0]) / scale);
  const mean = normalized.reduce((sum, y) => sum + y, 0) / ys.length;
  let total = 0;
  let residual = 0;
  for (let index = 0; index < xs.length; index += 1) {
    total += (normalized[index] - mean) ** 2;
    residual += ((ys[index] - fit.predict(xs[index])) / scale) ** 2;
  }
  if (!Number.isFinite(residual) || !Number.isFinite(total)) return;
  const r2 = total > 0 ? 1 - residual / total : residual === 0 ? 1 : null;
  return { ...fit, r2 };
}
