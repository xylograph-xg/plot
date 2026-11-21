import type { CurveFit } from './fitModels';

type Result = Omit<CurveFit, 'predict'>;

export const fitNumber = (value: number, digits = 6) => Number(value.toPrecision(digits)).toString();

export function linearEquation(fit: Result): string {
  const { value: slope } = fit.parameters[0];
  const { value: intercept } = fit.parameters[1];
  return `y = ${fitNumber(slope)}x ${intercept < 0 ? '−' : '+'} ${fitNumber(Math.abs(intercept))}`;
}

export function fitAnnotation(fit: Result, linear: boolean): string {
  const quality = `R² = ${fit.r2 == null ? '—' : fit.r2.toFixed(3)}`;
  if (linear) return [linearEquation(fit), quality].join('\n');
  const parameters = fit.parameters.map(({ symbol, value }) => `${symbol}=${fitNumber(value, symbol.startsWith('x') ? 12 : 5)}`);
  const rows = [];
  for (let index = 0; index < parameters.length; index += 2) rows.push(parameters.slice(index, index + 2).join('   '));
  return [fit.equation, ...rows, quality].join('\n');
}
