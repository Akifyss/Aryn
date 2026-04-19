import {
  DEFAULT_FIND_OPTIONS,
  readStoredState,
  resolveFindOptions,
  resolveGitChangesGutterEnabled,
  shouldRememberViewPosition,
  writeStoredState,
} from '@/features/editor/lib/meo-state'
import type { MeoEditorViewportPosition } from '@/features/editor/lib/meo-native-editor-types'

type ViewPositionPersistenceController = {
  captureViewPosition: () => void
  getFindOptions: () => {
    caseSensitive: boolean
    wholeWord: boolean
  }
  getInitialGitChangesGutterVisible: () => boolean
  getInitialLineNumbersVisible: () => boolean
  getInitialOutlineVisible: () => boolean
  getInitialRestoreTopLine: (content: string, rememberPositionLines: number) => number | undefined
  getInitialRestoreTopLineOffset: (content: string, rememberPositionLines: number) => number
  getInitialMode: () => 'live' | 'source'
  persistFindOptions: (value: unknown) => void
  persistGitChangesGutterVisible: (visible: boolean) => void
  persistLineNumbersVisible: (visible: boolean) => void
  persistMode: (mode: 'live' | 'source') => void
  persistOutlineVisible: (visible: boolean) => void
  persistViewPositionFromMessage: (message: { topLine?: number, topLineOffset?: number }, content: string, rememberPositionLines: number) => void
  scheduleViewPositionCapture: () => void
}

const VIEW_POSITION_DEBOUNCE_MS = 250

export function createMeoViewPositionPersistenceController(options: {
  filePath: string
  getCurrentText: () => string
  getEditorPosition: () => MeoEditorViewportPosition | null
  rememberPositionLines: number
}) {
  let pendingViewPositionTimer: number | null = null

  const storedState = readStoredState(options.filePath)

  const captureViewPosition = () => {
    const position = options.getEditorPosition()
    if (!position) {
      return
    }

    const shouldPersistViewPosition = shouldRememberViewPosition(
      options.getCurrentText(),
      options.rememberPositionLines,
    )

    writeStoredState(options.filePath, {
      topLine: shouldPersistViewPosition ? position.line : undefined,
      topLineOffset: shouldPersistViewPosition ? position.lineOffset : undefined,
    })
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
      getInitialMode: () => storedState.mode ?? 'source',
      getInitialOutlineVisible: () => storedState.outlineVisible ?? false,
      getInitialRestoreTopLine: (content, rememberPositionLines) => (
        shouldRememberViewPosition(content, rememberPositionLines)
          ? storedState.topLine ?? undefined
          : undefined
      ),
      getInitialRestoreTopLineOffset: (content, rememberPositionLines) => (
        shouldRememberViewPosition(content, rememberPositionLines)
          ? storedState.topLineOffset ?? 0
          : 0
      ),
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
      persistViewPositionFromMessage: (message, content, rememberPositionLines) => {
        writeStoredState(options.filePath, {
          topLine: shouldRememberViewPosition(content, rememberPositionLines)
            && typeof message.topLine === 'number'
            ? message.topLine
            : undefined,
          topLineOffset: shouldRememberViewPosition(content, rememberPositionLines)
            && typeof message.topLineOffset === 'number'
            ? message.topLineOffset
            : undefined,
        })
      },
      scheduleViewPositionCapture: () => {
        if (pendingViewPositionTimer !== null) {
          window.clearTimeout(pendingViewPositionTimer)
        }

        pendingViewPositionTimer = window.setTimeout(() => {
          pendingViewPositionTimer = null
          captureViewPosition()
        }, VIEW_POSITION_DEBOUNCE_MS)
      },
    } satisfies ViewPositionPersistenceController,
  }
}
