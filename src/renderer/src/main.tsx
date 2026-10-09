import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useProjectStore } from './store/projectStore'
import Konva from 'konva'

// GUI smoke-test hook. VITE_MEP_E2E is only defined by e2e/vite.e2e.config.ts, so this is
// constant-folded away (and the imports tree-shaken from this entry) in the production build.
if (import.meta.env.VITE_MEP_E2E === '1') Object.assign(window, { __mep: { store: useProjectStore, Konva } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
