interface Diagnostic {
  context: string;
  detail: string;
}

let latest: Diagnostic | null = null;
const listeners = new Set<() => void>();

export const getDiagnostic = () => latest;
export function subscribeToDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function reportError(context: string, error: unknown) {
  latest = { context, detail: error instanceof Error ? error.stack ?? error.message : String(error) };
  console.error(context, error);
  listeners.forEach((listener) => listener());
}

export function clearDiagnostic() {
  latest = null;
  listeners.forEach((listener) => listener());
}
