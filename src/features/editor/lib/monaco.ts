import '@codingame/monaco-editor-wrapper/features/extensionHostWorker'
import '@codingame/monaco-vscode-css-language-features-default-extension'
import '@codingame/monaco-vscode-html-language-features-default-extension'
import '@codingame/monaco-vscode-json-language-features-default-extension'
import '@codingame/monaco-vscode-theme-defaults-default-extension'
import '@codingame/monaco-vscode-typescript-language-features-default-extension'

import {
  createEditor as createConfiguredEditor,
  createModelReference,
  initialize,
  registerFile,
} from '@codingame/monaco-editor-wrapper'
import { RegisteredMemoryFile } from '@codingame/monaco-vscode-files-service-override'
import type { IReference, ITextFileEditorModel } from '@codingame/monaco-vscode-api/monaco'
import * as monaco from 'monaco-editor'

type CachedMonacoFileModel = {
  readonly registration: monaco.IDisposable | null
  readonly retainedModelRef: IReference<ITextFileEditorModel>
  readonly uri: monaco.Uri
}

const cachedMonacoFileModels = new Map<string, CachedMonacoFileModel>()
let monacoInitializePromise: Promise<void> | null = null

export type MonacoEditorOptions = monaco.editor.IStandaloneEditorConstructionOptions
export type MonacoThemePreference = 'light' | 'dark' | 'auto'

export function resolveMonacoTheme(theme: MonacoThemePreference = 'auto') {
  if (theme === 'auto') {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'vs-dark'
      : 'vs'
  }

  return theme === 'dark' ? 'vs-dark' : 'vs'
}

export async function ensureMonacoReady() {
  if (!monacoInitializePromise) {
    monacoInitializePromise = initialize()
  }

  await monacoInitializePromise
  return monaco
}

function isAlreadyExistsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('already exists')
}

async function createOrReuseModelReference(uri: monaco.Uri, initialContent: string) {
  let registration: monaco.IDisposable | null = null

  try {
    registration = registerFile(new RegisteredMemoryFile(uri, initialContent))
  } catch (error) {
    // During HMR or after a partial Monaco reset, the in-memory file may
    // already exist in the VS Code file service even if our local cache map
    // has been recreated. In that case we should reuse the existing file
    // instead of trying to register it again.
    if (!isAlreadyExistsError(error)) {
      throw error
    }
  }

  try {
    const modelRef = await createModelReference(uri)
    return {
      modelRef,
      registration,
    }
  } catch (error) {
    registration?.dispose()
    throw error
  }
}

async function getOrCreateCachedMonacoFileModel(filePath: string, initialContent: string) {
  await ensureMonacoReady()

  const existingModel = cachedMonacoFileModels.get(filePath)
  if (existingModel) {
    return existingModel
  }

  const uri = monaco.Uri.file(filePath)
  const {
    modelRef: retainedModelRef,
    registration,
  } = await createOrReuseModelReference(uri, initialContent)
  const nextModel: CachedMonacoFileModel = {
    registration,
    retainedModelRef,
    uri,
  }

  cachedMonacoFileModels.set(filePath, nextModel)
  return nextModel
}

export async function acquireMonacoFileModel(filePath: string, initialContent: string) {
  const cachedModel = await getOrCreateCachedMonacoFileModel(filePath, initialContent)
  const modelRef = await createModelReference(cachedModel.uri)

  return {
    modelRef,
    release() {
      modelRef.dispose()
    },
  }
}

export function createMonacoEditor(
  container: HTMLElement,
  options?: MonacoEditorOptions,
) {
  return createConfiguredEditor(container, options)
}

export function resetMonacoFileModels() {
  cachedMonacoFileModels.forEach((model) => {
    model.retainedModelRef.dispose()
    model.registration?.dispose()
  })
  cachedMonacoFileModels.clear()
}

export { monaco }
