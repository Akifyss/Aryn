import {
  DEFAULT_FIND_OPTIONS,
  type MeoStoredViewPosition,
  readStoredState,
  resolveFindOptions,
  resolveGitChangesGutterEnabled,
  writeStoredState,
} from '@/features/editor/lib/meo-state'
import type { MeoEditorMode, MeoEditorViewportPosition } from '@/features/editor/lib/meo-native-editor-types'

type ViewPositionPersistenceController = {
  captureViewPosition: (mode?: MeoEditorMode) => void
  getFindOptions: () => {
    caseSensitive: boolean
    wholeWord: boolean
  }
  getInitialGitChangesGutterVisible: () => boolean
  getInitialLineNumbersVisible: () => boolean
  getInitialOutlineVisible: () => boolean
  getInitialRestoreTopLine: (mode?: MeoEditorMode) => number | undefined
  getInitialRestoreTopLineOffset: (mode?: MeoEditorMode) => number
  getInitialMode: () => MeoEditorMode
  getStoredViewPosition: (mode?: MeoEditorMode) => MeoStoredViewPosition | undefined
  persistFindOptions: (value: unknown) => void
  persistGitChangesGutterVisible: (visible: boolean) => void
  persistLineNumbersVisible: (visible: boolean) => void
  persistMode: (mode: MeoEditorMode) => void
  persistOutlineVisible: (visible: boolean) => void
  persistViewPositionFromMessage: (message: { topLine?: number, topLineOffset?: number }, mode?: MeoEditorMode) => void
  scheduleViewPositionCapture: (mode?: MeoEditorMode) => void
}

const VIEW_POSITION_DEBOUNCE_MS = 250

export function createMeoViewPositionPersistenceController(options: {
  filePath: string
  getEditorPosition: () => MeoEditorViewportPosition | null
  getMode: () => MeoEditorMode
}) {
  let pendingViewPositionTimer: number | null = null

  const storedState = readStoredState(options.filePath)
  const initialMode = storedState.mode ?? 'live'
  let storedViewPositions: Partial<Record<MeoEditorMode, MeoStoredViewPosition>> = {
    ...storedState.viewPositions,
  }
  const observedNonDefaultModes = new Set<MeoEditorMode>()

  if (
    typeof storedState.topLine === 'number'
    && !storedViewPositions[initialMode]
  ) {
    storedViewPositions = {
      ...storedViewPositions,
      [initialMode]: {
        topLine: storedState.topLine,
        topLineOffset: storedState.topLineOffset ?? 0,
      },
    }
  }

  const resolveMode = (mode?: MeoEditorMode) => mode ?? options.getMode()

  const getStoredViewPosition = (mode?: MeoEditorMode) => storedViewPositions[resolveMode(mode)]

  const isDefaultTopPosition = (position: MeoEditorViewportPosition) => (
    position.line <= 1 && position.lineOffset <= 0
  )

  const hasInvalidViewportMetrics = (position: MeoEditorViewportPosition) => (
    (typeof position.clientHeight === 'number' && position.clientHeight <= 0)
    || (typeof position.scrollHeight === 'number' && position.scrollHeight <= 0)
  )

  const shouldSkipDefaultTopOverwrite = (mode: MeoEditorMode, position: MeoEditorViewportPosition) => {
    const storedPosition = getStoredViewPosition(mode)

    return Boolean(
      storedPosition
      && storedPosition.topLine > 1
      && !observedNonDefaultModes.has(mode)
      && isDefaultTopPosition(position),
    )
  }

  const markObservedPosition = (mode: MeoEditorMode, position: MeoEditorViewportPosition) => {
    if (!isDefaultTopPosition(position) && !hasInvalidViewportMetrics(position)) {
      observedNonDefaultModes.add(mode)
    }
  }

  const writeViewPosition = (mode: MeoEditorMode, position: MeoEditorViewportPosition) => {
    const nextPosition = {
      topLine: position.line,
      topLineOffset: position.lineOffset,
    }
    storedViewPositions = {
      ...storedViewPositions,
      [mode]: nextPosition,
    }

    writeStoredState(options.filePath, {
      topLine: nextPosition.topLine,
      topLineOffset: nextPosition.topLineOffset,
      viewPositions: storedViewPositions,
    })
  }

  const captureViewPosition = (requestedMode?: MeoEditorMode) => {
    const mode = resolveMode(requestedMode)
    const position = options.getEditorPosition()
    if (!position) {
      return
    }

    if (hasInvalidViewportMetrics(position) || shouldSkipDefaultTopOverwrite(mode, position)) {
      return
    }

    markObservedPosition(mode, position)
    writeViewPosition(mode, position)
  }

  return {
    cancelScheduledViewPositionCapture() {
      if (pendingViewPositionTimer !== null) {
        window.clearTimeout(pendingViewPositionTimer)
        pendingViewPositionTimer = null
      }
    },
    controller: {
      captureViewPosition,
      getFindOptions: () => storedState.findOptions ?? DEFAULT_FIND_OPTIONS,
      getInitialGitChangesGutterVisible: () => resolveGitChangesGutterEnabled(storedState),
      getInitialLineNumbersVisible: () => storedState.lineNumbers ?? true,
      getInitialMode: () => initialMode,
      getInitialOutlineVisible: () => storedState.outlineVisible ?? false,
      getInitialRestoreTopLine: (mode) => getStoredViewPosition(mode)?.topLine,
      getInitialRestoreTopLineOffset: (mode) => getStoredViewPosition(mode)?.topLineOffset ?? 0,
      getStoredViewPosition,
      persistFindOptions: (value) => {
        writeStoredState(options.filePath, {
          findOptions: resolveFindOptions(value),
        })
      },
      persistGitChangesGutterVisible: (visible) => {
        writeStoredState(options.filePath, {
          gitChangesGutter: visible,
          gitChangesGutterConfigured: true,
        })
      },
      persistLineNumbersVisible: (visible) => {
        writeStoredState(options.filePath, { lineNumbers: visible })
      },
      persistMode: (mode) => {
        writeStoredState(options.filePath, { mode })
      },
      persistOutlineVisible: (visible) => {
        writeStoredState(options.filePath, { outlineVisible: visible })
      },
      persistViewPositionFromMessage: (message, requestedMode?: MeoEditorMode) => {
        if (typeof message.topLine !== 'number') {
          return
        }

        const mode = resolveMode(requestedMode)
        const position = {
          line: message.topLine,
          lineOffset: typeof message.topLineOffset === 'number' ? message.topLineOffset : 0,
        } satisfies MeoEditorViewportPosition
        if (shouldSkipDefaultTopOverwrite(mode, position)) {
          return
        }

        markObservedPosition(mode, position)
        writeViewPosition(mode, position)
      },
      scheduleViewPositionCapture: (requestedMode?: MeoEditorMode) => {
        const mode = resolveMode(requestedMode)
        if (pendingViewPositionTimer !== null) {
          window.clearTimeout(pendingViewPositionTimer)
        }

        pendingViewPositionTimer = window.setTimeout(() => {
          pendingViewPositionTimer = null
          captureViewPosition(mode)
        }, VIEW_POSITION_DEBOUNCE_MS)
      },
    } satisfies ViewPositionPersistenceController,
  }
}
