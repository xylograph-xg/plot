import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { AppErrorBoundary } from './components/layout/AppErrorBoundary'
import { Diagnostics } from './components/layout/Diagnostics'
import { reportError } from './lib/diagnostics'
import { FitWindow } from './components/panels/FitWindow'

window.addEventListener('error', (event) => reportError('Window', event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => reportError('Promise', event.reason))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      {new URLSearchParams(window.location.search).has('fit') ? <FitWindow /> : <App />}
      <Diagnostics />
    </AppErrorBoundary>
  </StrictMode>,
)
