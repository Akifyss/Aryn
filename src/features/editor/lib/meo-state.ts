import type { PersistedMeoStoredState } from '@/features/persistence/types'

export type MeoStoredMode = 'diff-split' | 'diff-unified' | 'live' | 'source'
export type MeoStoredViewPosition = {
  topLine: number
  topLineOffset: number
}
export type MeoStoredState = PersistedMeoStoredState

const MEO_STORED_MODES: MeoStoredMode[] = ['diff-split', 'diff-unified', 'live', 'source']
let persistedMeoFileStates: Record<string, MeoStoredState> = {}

export function initializeMeoStoredStates(states: Record<string, MeoStoredState>) {
  persistedMeoFileStates = { ...states }
}

export const DEFAULT_FIND_OPTIONS = {
  caseSensitive: false,
  wholeWord: false,
} as const

function isStoredMode(value: unknown): value is MeoStoredMode {
  return MEO_STORED_MODES.includes(value as MeoStoredMode)
}

function resolveStoredMode(value: unknown) {
  return isStoredMode(value) ? value : undefined
}

export function resolveFindOptions(
  value: unknown,
) {
  const candidate = value && typeof value === 'object'
    ? value as { caseSensitive?: unknown, wholeWord?: unknown }
    : null

  return {
    caseSensitive: candidate?.caseSensitive === true,
    wholeWord: candidate?.wholeWord === true,
  }
}

function resolveOptionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function resolveOptionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function resolveStoredViewPosition(value: unknown): MeoStoredViewPosition | undefined {
  const candidate = value && typeof value === 'object'
    ? value as { topLine?: unknown, topLineOffset?: unknown }
    : null
  const topLine = resolveOptionalNumber(candidate?.topLine)

  if (typeof topLine !== 'number') {
    return undefined
  }

  return {
    topLine,
    topLineOffset: resolveOptionalNumber(candidate?.topLineOffset) ?? 0,
  }
}

function resolveStoredViewPositions(value: unknown): Partial<Record<MeoStoredMode, MeoStoredViewPosition>> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const source = value as Record<string, unknown>
  const viewPositions: Partial<Record<MeoStoredMode, MeoStoredViewPosition>> = {}

  MEO_STORED_MODES.forEach((mode) => {
    const position = resolveStoredViewPosition(source[mode])
    if (position) {
      viewPositions[mode] = position
    }
  })

  return Object.keys(viewPositions).length > 0 ? viewPositions : undefined
}

export function resolveGitChangesGutterEnabled(storedState: MeoStoredState) {
  if (storedState.gitChangesGutterConfigured === true && typeof storedState.gitChangesGutter === 'boolean') {
    return storedState.gitChangesGutter
  }

  return true
}

export function readStoredState(filePath: string): MeoStoredState {
  const storedState = persistedMeoFileStates[filePath]

  if (!storedState) {
    return {}
  }

  return {
    findOptions: resolveFindOptions(storedState.findOptions),
    gitChangesGutter: resolveOptionalBoolean(storedState.gitChangesGutter),
    gitChangesGutterConfigured: resolveOptionalBoolean(storedState.gitChangesGutterConfigured),
    lineNumbers: storedState.lineNumbers !== false,
    mode: resolveStoredMode(storedState.mode),
    outlineVisible: storedState.outlineVisible === true,
    topLine: resolveOptionalNumber(storedState.topLine),
    topLineOffset: resolveOptionalNumber(storedState.topLineOffset),
    viewPositions: resolveStoredViewPositions(storedState.viewPositions),
  }
}

export function writeStoredState(filePath: string, patch: Partial<MeoStoredState>) {
  const nextState = {
    ...readStoredState(filePath),
    ...patch,
  }

  persistedMeoFileStates[filePath] = nextState
  if (typeof window !== 'undefined' && window.appApi?.updateMeoFileState) {
    void window.appApi.updateMeoFileState(filePath, nextState).catch(() => undefined)
  }
  return nextState
}
