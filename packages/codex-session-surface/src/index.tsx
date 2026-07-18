import { type LegendListRef } from '@legendapp/list/react'
import { createRoot, type Root } from 'react-dom/client'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createCodexTimelineModel } from './adapter'
import type {
  CodexNativeSessionSnapshot,
  CodexOptimisticUserMessage,
  CodexSessionSurfaceOptions,
} from './contracts'
import { ExpandedImageDialog } from './upstream/t3code/ExpandedImageDialog'
import type { ExpandedImagePreview } from './upstream/t3code/ExpandedImagePreview'
import { MessagesTimeline } from './upstream/t3code/MessagesTimeline'
import './index.css'

export type CodexSessionSurface = {
  dispose: () => void
  setOptimisticUserMessages: (messages: CodexOptimisticUserMessage[]) => void
  setSnapshot: (snapshot: CodexNativeSessionSnapshot) => void
}

type SurfaceState = {
  optimisticUserMessages: CodexOptimisticUserMessage[]
  snapshot: CodexNativeSessionSnapshot
}

const EMPTY_REVERT_COUNTS = new Map<string, number>()
const NOOP = () => {}

function readResolvedTheme() {
  const root = document.documentElement
  return root.classList.contains('dark') || root.dataset.theme === 'dark' ? 'dark' : 'light'
}

function useResolvedTheme() {
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(readResolvedTheme)

  useLayoutEffect(() => {
    const root = document.documentElement
    const syncTheme = () => setResolvedTheme(readResolvedTheme())
    syncTheme()

    const observer = new MutationObserver(syncTheme)
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return resolvedTheme
}

function Surface({ initialOptions, registerUpdate }: {
  initialOptions: CodexSessionSurfaceOptions
  registerUpdate: (update: ((next: Partial<SurfaceState>) => void) | null) => void
}) {
  const [state, setState] = useState<SurfaceState>({
    optimisticUserMessages: initialOptions.optimisticUserMessages ?? [],
    snapshot: initialOptions.snapshot,
  })
  const [expandedImagePreview, setExpandedImagePreview] = useState<ExpandedImagePreview | null>(null)
  const listRef = useRef<LegendListRef | null>(null)
  const resolvedTheme = useResolvedTheme()
  useLayoutEffect(() => {
    registerUpdate((next) => setState((current) => ({ ...current, ...next })))
    return () => registerUpdate(null)
  }, [registerUpdate])
  const model = useMemo(
    () => createCodexTimelineModel(state.snapshot, state.optimisticUserMessages),
    [state.optimisticUserMessages, state.snapshot],
  )
  const handleOpenTurnDiff = useCallback((_turnId: string, filePath?: string) => {
    if (filePath) initialOptions.bridge?.openWorkspaceFile?.(filePath)
  }, [initialOptions.bridge])

  return (
    <>
      <MessagesTimeline
        isWorking={model.isWorking}
        activeTurnInProgress={model.activeTurnInProgress}
        activeTurnStartedAt={model.activeTurnStartedAt}
        listRef={listRef}
        timelineEntries={model.timelineEntries}
        latestTurn={model.latestTurn}
        runningTurnId={model.runningTurnId}
        turnDiffSummaryByAssistantMessageId={model.turnDiffSummaryByAssistantMessageId}
        routeThreadKey={`codex:${state.snapshot.thread.id}`}
        onOpenTurnDiff={handleOpenTurnDiff}
        revertTurnCountByUserMessageId={EMPTY_REVERT_COUNTS}
        onRevertUserMessage={NOOP}
        isRevertingCheckpoint={false}
        onImageExpand={setExpandedImagePreview}
        activeThreadEnvironmentId='aryn'
        markdownCwd={initialOptions.workspacePath}
        resolvedTheme={resolvedTheme}
        timestampFormat='absolute'
        workspaceRoot={initialOptions.workspacePath}
        anchorMessageId={null}
        onAnchorReady={NOOP}
        onAnchorSizeChanged={NOOP}
        contentInsetEndAdjustment={0}
        onIsAtEndChange={NOOP}
        onManualNavigation={NOOP}
      />
      {expandedImagePreview ? (
        <ExpandedImageDialog
          preview={expandedImagePreview}
          onClose={() => setExpandedImagePreview(null)}
        />
      ) : null}
    </>
  )
}

export function mountCodexSessionSurface(
  container: HTMLElement,
  options: CodexSessionSurfaceOptions,
): CodexSessionSurface {
  const alreadyScoped = container.classList.contains('aryn-codex-session-surface')
  container.classList.add('aryn-codex-session-surface')
  let root: Root | null = createRoot(container)
  let update: ((next: Partial<SurfaceState>) => void) | null = null
  let pendingUpdate: Partial<SurfaceState> | null = null
  const registerUpdate = (value: ((next: Partial<SurfaceState>) => void) | null) => {
    update = value
    if (update && pendingUpdate) {
      update(pendingUpdate)
      pendingUpdate = null
    }
  }
  root.render(<Surface initialOptions={options} registerUpdate={registerUpdate} />)

  const enqueueUpdate = (next: Partial<SurfaceState>) => {
    if (update) {
      update(next)
      return
    }
    if (root) pendingUpdate = { ...pendingUpdate, ...next }
  }

  return {
    dispose() {
      root?.unmount()
      root = null
      pendingUpdate = null
      if (!alreadyScoped) container.classList.remove('aryn-codex-session-surface')
    },
    setOptimisticUserMessages(messages) {
      enqueueUpdate({ optimisticUserMessages: messages })
    },
    setSnapshot(snapshot) {
      enqueueUpdate({ snapshot })
    },
  }
}

export type {
  CodexNativeSessionSnapshot,
  CodexOptimisticUserMessage,
  CodexSessionSurfaceOptions,
} from './contracts'
