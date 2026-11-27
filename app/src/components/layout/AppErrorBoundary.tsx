import { Component, type ReactNode } from 'react';
import i18n from '../../i18n';
import { reportError } from '../../lib/diagnostics';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportError('React', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="h-full overflow-auto p-6" role="alert">
        <h1 className="mb-3 text-lg font-semibold">{i18n.t('diagnostics.crash')}</h1>
        <button className="btn" onClick={() => this.setState({ error: null })}>{i18n.t('diagnostics.retry')}</button>
        <pre className="mt-3 whitespace-pre-wrap">{error.stack ?? error.message}</pre>
      </main>
    );
  }
}
