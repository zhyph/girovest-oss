import { createRoot } from 'react-dom/client'
// Self-hosted so the app keeps its typography with no internet — this
// ships as an offline Electron desktop app, where a Google Fonts <link>
// would quietly degrade to the fallback stack on a shop machine.
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource-variable/source-serif-4'
import '@fontsource-variable/azeret-mono'
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
