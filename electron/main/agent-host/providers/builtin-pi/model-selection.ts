import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { SettingsManager } from '@earendil-works/pi-coding-agent'
import {
  getSupportedThinkingLevels,
  type Api,
  type Model,
} from '@earendil-works/pi-ai'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'

export const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] satisfies ThinkingLevel[]

let defaultModelPerProviderPromise: Promise<Record<string, string>> | null = null

export function loadPiDefaultModelPerProvider() {
  defaultModelPerProviderPromise ??= (async () => {
    try {
      const piEntryPath = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))
      const resolverPath = path.join(path.dirname(piEntryPath), 'core', 'model-resolver.js')
      const resolverModule = await import(pathToFileURL(resolverPath).href) as {
        defaultModelPerProvider?: Record<string, string>
      }
      return resolverModule.defaultModelPerProvider ?? {}
    } catch {
      return {}
    }
  })()
  return defaultModelPerProviderPromise
}

function selectProviderPreferredModel(
  availableModels: Model<Api>[],
  defaultModelPerProvider: Record<string, string>,
  provider: string,
) {
  const providerModels = availableModels.filter((model) => model.provider === provider)
  if (providerModels.length === 0) return null
  const defaultModelId = defaultModelPerProvider[provider]
  return providerModels.find((model) => model.id === defaultModelId) ?? providerModels[0]
}

export function selectPiPreferredModel(
  availableModels: Model<Api>[],
  settingsManager: SettingsManager,
  defaultModelPerProvider: Record<string, string>,
) {
  const preferredProvider = settingsManager.getDefaultProvider()
  const preferredModel = settingsManager.getDefaultModel()
  if (preferredProvider && preferredModel) {
    const preferredSelection = availableModels.find((model) => (
      model.provider === preferredProvider && model.id === preferredModel
    ))
    if (preferredSelection) return preferredSelection
  }
  for (const [provider, modelId] of Object.entries(defaultModelPerProvider)) {
    const defaultSelection = availableModels.find((model) => model.provider === provider && model.id === modelId)
    if (defaultSelection) return defaultSelection
  }
  return availableModels[0] ?? null
}

export function getProviderPreferredModelKeys(
  availableModels: Model<Api>[],
  defaultModelPerProvider: Record<string, string>,
) {
  const modelKeys: Record<string, string> = {}
  const providers = Array.from(new Set(availableModels.map((model) => model.provider)))
  for (const provider of providers) {
    const selectedModel = selectProviderPreferredModel(availableModels, defaultModelPerProvider, provider)
    if (selectedModel) modelKeys[provider] = `${selectedModel.provider}/${selectedModel.id}`
  }
  return modelKeys
}

export function getThinkingLevelsByModel(availableModels: Model<Api>[]) {
  return Object.fromEntries(availableModels.map((model) => (
    [`${model.provider}/${model.id}`, getSupportedThinkingLevels(model)]
  ))) as Record<string, ThinkingLevel[]>
}

export function getInputsByModel(availableModels: Model<Api>[]) {
  return Object.fromEntries(availableModels.map((model) => (
    [`${model.provider}/${model.id}`, [...model.input]]
  ))) as Record<string, Array<'text' | 'image'>>
}

export function isPiThinkingLevel(value: string): value is ThinkingLevel {
  return PI_THINKING_LEVELS.includes(value as ThinkingLevel)
}
