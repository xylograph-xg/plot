import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ActiveTrendlineKind, ChartConfig, SpectrumFitConfig } from '../../types';
import { axisBounds } from '../../lib/axisBounds';
import { reportError } from '../../lib/diagnostics';
import type { FitRequest, FitResult } from '../../lib/fitJob';
import { normalizedSeries } from '../../lib/normalization';
import { activeSpectrumFits, isSpectrumTarget, spectrumAdjustmentKey } from '../../lib/spectrum';
import { selectedTrendlines } from '../../lib/trendlineSelection';
import { hasCategoricalX, isCurveVisible, supportsTrendline, type ResolvedSeries } from '../../lib/xySeries';

type Job = { result?: FitResult; failed?: boolean };

const cachedJobs = new WeakMap<ResolvedSeries['points'], Map<string, Job>>();
const listeners = new Set<() => void>();
const queue = new Map<Job, { request: FitRequest; users: number }>();
let worker: Worker | undefined;
let running: Job | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function finish(result?: FitResult, error?: unknown) {
  const job = running;
  running = undefined;
  if (job) {
    if (result) job.result = result;
    else {
      job.failed = true;
      reportError('Fit worker', error);
    }
    listeners.forEach((listener) => listener());
  }
  nextJob();
}

function nextJob() {
  if (running) return;
  for (const [job, { request }] of queue) {
    queue.delete(job);
    running = job;
    try {
      if (!worker) {
        worker = new Worker(new URL('../../lib/fit.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ result?: FitResult; error?: string }>) =>
          finish(event.data.result, event.data.error);
        worker.onerror = (event) => {
          event.preventDefault();
          worker?.terminate();
          worker = undefined;
          finish(undefined, event.message || 'Could not load the fit worker');
        };
        worker.onmessageerror = () => finish(undefined, 'Could not read the fit result');
      }
      worker.postMessage(request);
    } catch (error) {
      finish(undefined, error);
    }
    return;
  }
}

function cachedJob(request: FitRequest): Job {
  const { chart, series } = request;
  const yAxis = series.mapping.y2 ? chart.y2Axis : chart.yAxis;
  const axis = (value: ChartConfig['xAxis']) => [value.scale, axisBounds(value)];
  const method = request.type === 'trendline' ? request.kind : [request.config, spectrumAdjustmentKey(chart, series.mapping)];
  const key = JSON.stringify([request.type, method, axis(chart.xAxis), axis(yAxis)]);
  let jobs = cachedJobs.get(series.points);
  if (!jobs) {
    jobs = new Map();
    cachedJobs.set(series.points, jobs);
  }
  const existing = jobs.get(key);
  if (existing) return existing;
  const job = {};
  jobs.set(key, job);
  const oldest = jobs.keys().next().value;
  if (jobs.size > 32 && oldest !== undefined) jobs.delete(oldest);
  return job;
}

function prepare(chart: ChartConfig | undefined, raw: ResolvedSeries[]) {
  const jobs = new Map<Job, FitRequest>();
  const results = new Map<ResolvedSeries, { trends: Map<ActiveTrendlineKind, Job>; spectra: Map<SpectrumFitConfig, Job> }>();
  if (!chart || !supportsTrendline(chart.type)) return { jobs, results };
  const visible = raw.filter(isCurveVisible);
  if (hasCategoricalX(visible)) return { jobs, results };
  const configs = activeSpectrumFits(chart);
  for (const series of visible.map(normalizedSeries)) {
    const trends = new Map<ActiveTrendlineKind, Job>();
    const spectra = new Map<SpectrumFitConfig, Job>();
    for (const kind of selectedTrendlines(series.mapping)) {
      const request: FitRequest = { type: 'trendline', chart, series, kind };
      const job = cachedJob(request);
      jobs.set(job, request);
      trends.set(kind, job);
    }
    for (const config of configs) {
      if (!isSpectrumTarget(config, series)) continue;
      const request: FitRequest = { type: 'spectrum', chart, series, config };
      const job = cachedJob(request);
      jobs.set(job, request);
      spectra.set(config, job);
    }
    results.set(series, { trends, spectra });
  }
  return { jobs, results };
}

export function useFitResults(chart: ChartConfig | undefined, series: ResolvedSeries[]) {
  const { jobs, results } = useMemo(() => prepare(chart, series), [chart, series]);
  const settled = useSyncExternalStore(subscribe, () => {
    let count = 0;
    for (const job of jobs.keys()) if (job.result || job.failed) count += 1;
    return count;
  });

  useEffect(() => {
    const pending: Job[] = [];
    const timer = setTimeout(() => {
      for (const [job, request] of jobs) {
        if (job.result || job.failed || running === job) continue;
        const queued = queue.get(job);
        if (queued) queued.users += 1;
        else queue.set(job, { request, users: 1 });
        pending.push(job);
      }
      nextJob();
    }, 120);
    return () => {
      clearTimeout(timer);
      for (const job of pending) {
        const queued = queue.get(job);
        if (queued && --queued.users === 0) queue.delete(job);
      }
    };
  }, [jobs]);

  return useMemo(() => ({
    pending: settled < jobs.size,
    trendline: (item: ResolvedSeries, kind: ActiveTrendlineKind) => {
      const job = results.get(item)?.trends.get(kind);
      const result = job?.result;
      if (result?.type === 'trendline') return result.value;
      if (job?.failed) return { error: 'failed' as const, count: 0, excluded: 0, points: [], residuals: [] };
    },
    spectrum: (item: ResolvedSeries, config: SpectrumFitConfig) => {
      const job = results.get(item)?.spectra.get(config);
      const result = job?.result;
      if (result?.type === 'spectrum') return result.value;
      if (job?.failed) return { error: 'failed' as const };
    },
  }), [jobs, results, settled]);
}
