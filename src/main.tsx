import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { ErrorBoundary } from './error-boundary'
import { logFrontendError, logFrontendMessage } from '@/lib/frontend-log'
import '@/app/globals.css'

window.addEventListener('error', (event) => {
  void logFrontendError(`window error: ${event.error?.stack ?? event.message}`)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  void logFrontendError(`unhandled rejection: ${reason?.stack ?? reason?.message ?? String(reason)}`)
})

void logFrontendMessage('frontend main loaded')

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
