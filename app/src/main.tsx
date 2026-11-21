import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { FitWindow } from './components/panels/FitWindow'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).has('fit') ? <FitWindow /> : <App />}
  </StrictMode>,
)
