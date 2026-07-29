import { createRoot } from 'react-dom/client'
import './i18n.ts'
import { App } from './App.tsx'
import { ChunkErrorBoundary } from './components/ChunkErrorBoundary.tsx'
import { initTheme } from './lib/useTheme.ts'
import './index.css'

initTheme()
createRoot(document.getElementById('root')!).render(
  <ChunkErrorBoundary>
    <App />
  </ChunkErrorBoundary>,
)
