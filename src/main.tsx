import React from 'react'
import ReactDOM from 'react-dom/client'
import { HeroUIProvider } from '@heroui/system'
import App from './App'
import { initializeSettingsStore } from '@/hooks/use-settings-store'
import { initializeMeoStoredStates } from '@/features/editor/lib/meo-state'
import {
  collectLocalStorageMigration,
  removeMigratedLocalStorageKeys,
} from '@/features/persistence/local-storage-migration'
import { initializeRendererPersistentState } from '@/features/persistence/renderer-state'

import './index.css'

async function bootstrap() {
  try {
    const migrationSnapshot = collectLocalStorageMigration(window.localStorage)
    const persistentState = await window.appApi.initializePersistentState(migrationSnapshot.migration)

    removeMigratedLocalStorageKeys(window.localStorage, migrationSnapshot.keysToRemove)
    initializeSettingsStore(persistentState.app.settings)
    initializeRendererPersistentState(persistentState)
    initializeMeoStoredStates(persistentState.workspace.meoFileStates)
  } catch (error) {
    console.error('Failed to initialize persisted Aryn state.', error)
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <HeroUIProvider>
        <App />
      </HeroUIProvider>
    </React.StrictMode>,
  )

  postMessage({ payload: 'removeLoading' }, '*')
  requestAnimationFrame(() => {
    window.appApi.notifyRendererReady()
  })
}

void bootstrap()
