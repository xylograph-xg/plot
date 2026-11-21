interface LeastSquaresResult {
  coefficients: number[];
  error: number;
}

function dot(left: ArrayLike<number>, right: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
}

/** Solve a small linear model via QR without forming the normal equations. */
export function leastSquares(columns: ArrayLike<number>[], y: number[]): LeastSquaresResult | null {
  const orthogonal: Float64Array[] = [];
  const triangular: number[][] = [];
  const coefficients: number[] = [];
  for (const input of columns) {
    const column = Float64Array.from(input);
    const projections = orthogonal.map((basis) => {
      const projection = dot(column, basis);
      for (let row = 0; row < column.length; row += 1) column[row] -= projection * basis[row];
      return projection;
    });
    const norm = Math.sqrt(dot(column, column));
    if (!Number.isFinite(norm) || norm <= 1e-10 * Math.sqrt(y.length)) return null;
    for (let row = 0; row < column.length; row += 1) column[row] /= norm;
    orthogonal.push(column);
    triangular.push([...projections, norm]);
    coefficients.push(dot(column, y));
  }
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    coefficients[index] /= triangular[index][index];
    for (let previous = 0; previous < index; previous += 1) {
      coefficients[previous] -= triangular[index][previous] * coefficients[index];
    }
  }
  let error = 0;
  for (let row = 0; row < y.length; row += 1) {
    let prediction = 0;
    for (let index = 0; index < columns.length; index += 1) prediction += columns[index][row] * coefficients[index];
    error += (y[row] - prediction) ** 2;
  }
  return Number.isFinite(error) ? { coefficients, error } : null;
}

interface Range {
  min: number;
  max: number;
  steps: number;
}

interface Trial extends LeastSquaresResult {
  shape: number[];
}

function refine(start: Trial, ranges: Range[], increments: number[], evaluate: (shape: number[]) => Trial | null,
  iterations = 220): Trial {
  const dimensions = ranges.length;
  const run = (values: number[]): Trial => {
    const shape = values.map((value, index) => Math.max(ranges[index].min, Math.min(ranges[index].max, value)));
    return evaluate(shape) ?? { shape, error: Infinity, coefficients: [] };
  };
  const simplex = [start, ...increments.map((step, index) => {
    const shape = [...start.shape];
    shape[index] += shape[index] + step <= ranges[index].max ? step : -step;
    return run(shape);
  })];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    simplex.sort((left, right) => left.error - right.error);
    const best = simplex[0];
    if (simplex.every((trial) => trial.shape.every((value, index) =>
      Math.abs(value - best.shape[index]) <= 1e-8 * increments[index]))) return best;

    const worst = simplex[dimensions];
    const centroid = best.shape.map((_, index) =>
      simplex.slice(0, dimensions).reduce((sum, trial) => sum + trial.shape[index] / dimensions, 0));
    const move = (trial: Trial, scale: number) => run(centroid.map((value, index) =>
      value + scale * (trial.shape[index] - value)));
    const reflected = move(worst, -1);
    if (reflected.error < best.error) {
      const expanded = move(worst, -2);
      simplex[dimensions] = expanded.error < reflected.error ? expanded : reflected;
    } else if (reflected.error < simplex[dimensions - 1].error) {
      simplex[dimensions] = reflected;
    } else {
      const target = reflected.error < worst.error ? reflected : worst;
      const contracted = move(target, 0.5);
      if (contracted.error < target.error) simplex[dimensions] = contracted;
      else {
        for (let index = 1; index < simplex.length; index += 1) {
          simplex[index] = run(best.shape.map((value, axis) => (value + simplex[index].shape[axis]) / 2));
        }
      }
    }
  }
  return simplex.reduce((best, trial) => trial.error < best.error ? trial : best);
}

export function fitFromSeeds(
  bounds: Pick<Range, 'min' | 'max'>[], seeds: number[][], steps: number[],
  evaluate: (shape: number[]) => LeastSquaresResult | null,
): Trial | undefined {
  const ranges = bounds.map((bound) => ({ ...bound, steps: 1 }));
  let best: Trial | undefined;
  const run = (shape: number[]): Trial | null => {
    const result = evaluate(shape);
    return result && { ...result, shape };
  };
  for (const seed of seeds) {
    const shape = seed.map((value, index) => Math.max(ranges[index].min, Math.min(ranges[index].max, value)));
    // Invalid seeds still define a simplex, which can move into the valid region.
    const initial = run(shape) ?? { shape, error: Infinity, coefficients: [] };
    const trial = refine(initial, ranges, steps, run, 480);
    if (Number.isFinite(trial.error) && (!best || trial.error < best.error)) best = trial;
  }
  return best;
}

/** Grid search for starting points, followed by bounded Nelder–Mead refinement. */
export function fitShape(
  ranges: Range[],
  evaluate: (shape: number[]) => LeastSquaresResult | null,
  seeds: number[][] = [],
): Trial | undefined {
  const increments = ranges.map(({ min, max, steps }) => (max - min) / steps);
  const run = (shape: number[]): Trial | null => {
    if (shape.some((value, index) => value < ranges[index].min || value > ranges[index].max)) return null;
    const solution = evaluate(shape);
    return solution && { ...solution, shape };
  };
  const grid = ranges.reduce<number[][]>((prefixes, { min, max, steps }) =>
    prefixes.flatMap((prefix) => Array.from({ length: steps + 1 }, (_, index) =>
      [...prefix, index === steps ? max : min + index * (max - min) / steps])), [[]]);
  const candidates = [...grid, ...seeds].map(run).filter((trial) => trial !== null)
    .sort((left, right) => left.error - right.error);
  const starts: Trial[] = [];
  for (const trial of candidates) {
    if (starts.every((other) => trial.shape.some((value, index) =>
      Math.abs(value - other.shape[index]) >= increments[index] * 1.5))) {
      starts.push(trial);
      if (starts.length === 3) break;
    }
  }
  let best = starts[0];
  for (const start of starts) {
    const trial = refine(start, ranges, increments, run);
    if (trial.error < best.error) best = trial;
  }
  return best;
}
