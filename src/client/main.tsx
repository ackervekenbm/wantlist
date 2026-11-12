import '@fontsource-variable/bricolage-grotesque/opsz.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme, readTheme } from './lib/theme'
import './styles.css'

// Before the first render, so a forced theme never flashes the system one.
applyTheme(readTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
