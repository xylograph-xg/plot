import type { AxisConfig } from '../types';

export function axisBounds(axis: AxisConfig) {
  const min = axis.min.trim() ? Number(axis.min) : undefined;
  const max = axis.max.trim() ? Number(axis.max) : undefined;
  const invalid = [min, max].some((value) => value !== undefined &&
    (!Number.isFinite(value) || (axis.scale === 'log' && value <= 0))) ||
    (min !== undefined && max !== undefined && min >= max);

  return invalid ? { invalid: true } : { invalid: false, min, max };
}
