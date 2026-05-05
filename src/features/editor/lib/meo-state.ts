export type MeoStoredMode = 'diff-split' | 'diff-unified' | 'live' | 'source'

export type MeoStoredViewPosition = {
  topLine: number
  topLineOffset: number
}

export type MeoStoredState = {
  findOptions?: {
    caseSensitive: boolean
    wholeWord: boolean
  }
  gitChangesGutter?: boolean
  gitChangesGutterConfigured?: boolean
  lineNumbers?: boolean
  mode?: MeoStoredMode
  outlineVisible?: boolean
  topLine?: number
  topLineOffset?: number
  viewPositions?: Partial<Record<MeoStoredMode, MeoStoredViewPosition>>
}

const MEO_STATE_STORAGE_PREFIX = 'aryn:meo-state:'
const MEO_STORED_MODES: MeoStoredMode[] = ['diff-split', 'diff-unified', 'live', 'source']

export const DEFAULT_FIND_OPTIONS = {
  caseSensitive: false,
  wholeWord: false,
} as const

function getStoredStateKey(filePath: string) {
  return `${MEO_STATE_STORAGE_PREFIX}${encodeURIComponent(filePath)}`
}

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
  try {
    const rawValue = window.localStorage.getItem(getStoredStateKey(filePath))
    if (!rawValue) {
      return {}
    }

    const parsedValue = JSON.parse(rawValue) as Partial<MeoStoredState>

    return {
      findOptions: resolveFindOptions(parsedValue.findOptions),
      gitChangesGutter: resolveOptionalBoolean(parsedValue.gitChangesGutter),
      gitChangesGutterConfigured: resolveOptionalBoolean(parsedValue.gitChangesGutterConfigured),
      lineNumbers: parsedValue.lineNumbers !== false,
      mode: resolveStoredMode(parsedValue.mode),
      outlineVisible: parsedValue.outlineVisible === true,
      topLine: resolveOptionalNumber(parsedValue.topLine),
      topLineOffset: resolveOptionalNumber(parsedValue.topLineOffset),
      viewPositions: resolveStoredViewPositions(parsedValue.viewPositions),
    }
  } catch {
    return {}
  }
}

export function writeStoredState(filePath: string, patch: Partial<MeoStoredState>) {
  const nextState = {
    ...readStoredState(filePath),
    ...patch,
  }

  window.localStorage.setItem(getStoredStateKey(filePath), JSON.stringify(nextState))
  return nextState
}
