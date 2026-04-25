export type MeoStoredState = {
  findOptions?: {
    caseSensitive: boolean
    wholeWord: boolean
  }
  gitChangesGutter?: boolean
  gitChangesGutterConfigured?: boolean
  lineNumbers?: boolean
  mode?: 'diff-split' | 'live' | 'source'
  outlineVisible?: boolean
  topLine?: number
  topLineOffset?: number
}

const MEO_STATE_STORAGE_PREFIX = 'aryn:meo-state:'

export const DEFAULT_FIND_OPTIONS = {
  caseSensitive: false,
  wholeWord: false,
} as const

function getStoredStateKey(filePath: string) {
  return `${MEO_STATE_STORAGE_PREFIX}${encodeURIComponent(filePath)}`
}

export function countTextLines(value: string) {
  if (!value) {
    return 1
  }

  return value.split(/\r\n|\r|\n/).length
}

export function shouldRememberViewPosition(content: string, rememberPositionLines: number) {
  if (rememberPositionLines <= 0) {
    return true
  }

  return countTextLines(content) >= rememberPositionLines
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
      mode: parsedValue.mode === 'diff-split' || parsedValue.mode === 'live' || parsedValue.mode === 'source'
        ? parsedValue.mode
        : undefined,
      outlineVisible: parsedValue.outlineVisible === true,
      topLine: typeof parsedValue.topLine === 'number' && Number.isFinite(parsedValue.topLine)
        ? parsedValue.topLine
        : undefined,
      topLineOffset: typeof parsedValue.topLineOffset === 'number' && Number.isFinite(parsedValue.topLineOffset)
        ? parsedValue.topLineOffset
        : undefined,
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
