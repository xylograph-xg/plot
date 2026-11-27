import { runFit, type FitRequest } from './fitJob';

self.addEventListener('message', ({ data }: MessageEvent<FitRequest>) => {
  try {
    self.postMessage({ result: runFit(data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.stack ?? error.message : String(error) });
  }
});
