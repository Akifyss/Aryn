import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { ThreadTimelineSurface } from './upstream/bb/apps/app/src/components/thread/timeline/ThreadTimelineSurface'
import { BottomAnchoredScrollBody } from './upstream/bb/apps/app/src/components/ui/bottom-anchored-scroll-body'
import { ThreadTimelineScrollToBottomButton } from './upstream/bb/apps/app/src/views/thread-detail/ThreadTimelineScrollToBottomButton'
import type {
  BbNativeFileChange,
  BbInteractionTimelineRecord,
  BbOptimisticUserMessage,
  BbSessionPaginationState,
  BbSessionRuntimeState,
  BbSessionSurface,
  BbSessionSurfaceOptions,
} from './contracts'
import { BbThemeProvider } from './compat/theme'
import {
  runtimeAnnouncementKey,
  runtimeAnnouncementMessage,
  type RuntimeAnnouncementState,
} from './compat/runtime-announcements'
import { projectNativeSession } from './projectors'
import { normalizeLocalAttachmentPath } from './projectors/common'
import './index.css'

type SurfaceErrorBoundaryProps = {
  children: ReactNode
  resetKey: number
}

type SurfaceErrorBoundaryState = {
  error: Error | null
}

class SurfaceErrorBoundary extends Component<
  SurfaceErrorBoundaryProps,
  SurfaceErrorBoundaryState
> {
  state: SurfaceErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): SurfaceErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[bb-session-surface] render failed', error, info)
  }

  componentDidUpdate(previousProps: SurfaceErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  private handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className='aryn-bb-session-surface__error' role='alert'>
        <strong>Unified view could not render this conversation.</strong>
        <span>{this.state.error.message}</span>
        <button
          className='aryn-bb-session-surface__retry'
          type='button'
          onClick={this.handleRetry}
        >
          Retry unified view
        </button>
      </div>
    )
  }
}

const KEYBOARD_IMAGE_SELECTOR = 'img.cursor-zoom-in'

function enhanceKeyboardImage(image: HTMLImageElement) {
  if (image.dataset.bbKeyboardImage === 'true') return
  if (image.closest('a, button, [role="button"], [role="link"]')) return

  image.dataset.bbKeyboardImage = 'true'
  image.tabIndex = 0
  image.setAttribute('role', 'button')
  image.setAttribute(
    'aria-label',
    image.alt ? `Open image preview: ${image.alt}` : 'Open image preview',
  )
}

function enhanceKeyboardImages(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>(KEYBOARD_IMAGE_SELECTOR).forEach(enhanceKeyboardImage)
}

function useBbAccessibilityBridge(rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    enhanceKeyboardImages(root)
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return
          if (node.matches(KEYBOARD_IMAGE_SELECTOR)) {
            enhanceKeyboardImage(node as HTMLImageElement)
          }
          node.querySelectorAll<HTMLImageElement>(KEYBOARD_IMAGE_SELECTOR).forEach(enhanceKeyboardImage)
        })
      })
    })
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        !(target instanceof HTMLImageElement)
        || target.dataset.bbKeyboardImage !== 'true'
        || (event.key !== 'Enter' && event.key !== ' ')
      ) {
        return
      }
      event.preventDefault()
      target.click()
    }

    observer.observe(root, { childList: true, subtree: true })
    root.addEventListener('keydown', handleKeyDown)
    return () => {
      observer.disconnect()
      root.removeEventListener('keydown', handleKeyDown)
    }
  }, [rootRef])
}

function RuntimeStatusAnnouncer(props: RuntimeAnnouncementState) {
  const key = runtimeAnnouncementKey(props)
  const previousKeyRef = useRef<string | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const previousKey = previousKeyRef.current
    if (previousKey === key) return
    previousKeyRef.current = key
    setMessage(runtimeAnnouncementMessage(key, previousKey))
  }, [key])

  return (
    <span
      className='aryn-bb-session-surface__runtime-status'
      role='status'
      aria-atomic='true'
      aria-live='polite'
    >
      {message}
    </span>
  )
}

function BbTimeline({
  options,
  projectionRevision,
}: {
  options: BbSessionSurfaceOptions
  projectionRevision: number
}) {
  const timelineRootRef = useRef<HTMLDivElement>(null)
  const projection = useMemo(() => projectNativeSession({
    fileChanges: options.fileChanges ?? [],
    interactionRecords: options.interactionRecords ?? [],
    optimisticMessages: options.optimisticUserMessages ?? [],
    projectionRevision,
    sessionId: options.sessionId,
    snapshot: options.snapshot,
    runtimeState: options.runtimeState,
    workspacePath: options.workspacePath,
  }), [
    options.fileChanges,
    options.interactionRecords,
    options.optimisticUserMessages,
    options.sessionId,
    options.snapshot,
    options.runtimeState,
    options.workspacePath,
    projectionRevision,
  ])
  useBbAccessibilityBridge(timelineRootRef)

  const handleOpenLink = useCallback(({ href }: { href: string }) => {
    if (!options.bridge?.openExternal) return false
    void options.bridge.openExternal(href)
    return true
  }, [options.bridge])

  const handleOpenLocalFile = useCallback(({ path }: { path: string }) => {
    if (!options.bridge?.openWorkspaceFile) return false
    void options.bridge.openWorkspaceFile(normalizeLocalAttachmentPath(path))
    return true
  }, [options.bridge])

  return (
    <div
      ref={timelineRootRef}
      className='aryn-bb-session-surface__timeline'
      data-agent-id={options.snapshot.agentId}
      data-session-id={options.sessionId}
    >
      <RuntimeStatusAnnouncer
        isStopping={projection.isStopping}
        label={projection.ongoingIndicatorLabel}
        status={projection.runtimeStatus}
      />
      <BottomAnchoredScrollBody
        footer={(
          <ThreadTimelineScrollToBottomButton
            active={projection.runtimeStatus === 'active'}
          />
        )}
        maxWidthClassName='max-w-[760px]'
        scrollAnchorThreadId={options.sessionId}
      >
        <ThreadTimelineSurface
          activeThinking={projection.activeThinking}
          canSpawnChild={false}
          hasOlderTimelineRows={options.paginationState?.hasOlderTimelineRows ?? false}
          isLoadingOlderTimelineRows={options.paginationState?.isLoadingOlderTimelineRows ?? false}
          isStopping={projection.isStopping}
          isThreadTimelinePending={false}
          timelineError={false}
          onOpenLink={handleOpenLink}
          onOpenLocalFileLink={handleOpenLocalFile}
          onLoadOlderRows={options.bridge?.loadOlderTimelineRows}
          showOngoingIndicator={projection.runtimeStatus === 'active'}
          ongoingIndicatorLabel={projection.ongoingIndicatorLabel}
          stoppingAnchorAt={projection.stoppingAnchorAt}
          timelineRows={projection.rows}
          threadId={options.sessionId}
          threadRuntimeDisplayStatus={projection.runtimeStatus}
          workspaceRootPath={options.workspacePath}
        />
      </BottomAnchoredScrollBody>
    </div>
  )
}

function renderSurface(
  root: Root,
  options: BbSessionSurfaceOptions,
  projectionRevision: number,
) {
  root.render(
    <SurfaceErrorBoundary
      key={`${options.snapshot.agentId}:${options.sessionId}`}
      resetKey={projectionRevision}
    >
      <BbThemeProvider theme={options.theme}>
        <MemoryRouter>
          <BbTimeline options={options} projectionRevision={projectionRevision} />
        </MemoryRouter>
      </BbThemeProvider>
    </SurfaceErrorBoundary>,
  )
}

export function mountBbSessionSurface(
  container: HTMLElement,
  initialOptions: BbSessionSurfaceOptions,
): BbSessionSurface {
  const surfaceElement = document.createElement('div')
  surfaceElement.className = 'aryn-bb-session-surface'
  surfaceElement.dataset.bbTheme = initialOptions.theme
  container.replaceChildren(surfaceElement)
  const root = createRoot(surfaceElement)
  let options: BbSessionSurfaceOptions = {
    ...initialOptions,
    fileChanges: initialOptions.fileChanges ?? [],
    interactionRecords: initialOptions.interactionRecords ?? [],
    optimisticUserMessages: initialOptions.optimisticUserMessages ?? [],
    paginationState: initialOptions.paginationState ?? {
      hasOlderTimelineRows: false,
      isLoadingOlderTimelineRows: false,
    },
    runtimeState: initialOptions.runtimeState ?? {},
  }
  let disposed = false
  let projectionRevision = 0
  let scheduledRuntimeProjectionFrame: number | null = null

  const render = () => {
    if (!disposed) renderSurface(root, options, projectionRevision)
  }
  const cancelScheduledRuntimeProjection = () => {
    if (scheduledRuntimeProjectionFrame === null) return
    cancelAnimationFrame(scheduledRuntimeProjectionFrame)
    scheduledRuntimeProjectionFrame = null
  }
  const renderUpdatedProjection = () => {
    cancelScheduledRuntimeProjection()
    projectionRevision += 1
    render()
  }
  const scheduleRuntimeProjection = () => {
    if (disposed || scheduledRuntimeProjectionFrame !== null) return
    scheduledRuntimeProjectionFrame = requestAnimationFrame(() => {
      scheduledRuntimeProjectionFrame = null
      projectionRevision += 1
      render()
    })
  }
  render()

  return {
    dispose() {
      if (disposed) return
      disposed = true
      cancelScheduledRuntimeProjection()
      root.unmount()
      surfaceElement.remove()
    },
    setFileChanges(fileChanges: BbNativeFileChange[]) {
      options = { ...options, fileChanges }
      renderUpdatedProjection()
    },
    setInteractionRecords(interactionRecords: BbInteractionTimelineRecord[]) {
      options = { ...options, interactionRecords }
      renderUpdatedProjection()
    },
    setOptimisticUserMessages(optimisticUserMessages: BbOptimisticUserMessage[]) {
      options = { ...options, optimisticUserMessages }
      renderUpdatedProjection()
    },
    setPaginationState(paginationState: BbSessionPaginationState) {
      options = { ...options, paginationState }
      render()
    },
    setRuntimeState(runtimeState: BbSessionRuntimeState) {
      options = { ...options, runtimeState }
      scheduleRuntimeProjection()
    },
    setSnapshot(snapshot) {
      options = { ...options, snapshot }
      renderUpdatedProjection()
    },
    setTheme(theme) {
      options = { ...options, theme }
      surfaceElement.dataset.bbTheme = theme
      render()
    },
  }
}

export type {
  BbAgentId,
  BbInteractionField,
  BbInteractionOption,
  BbInteractionTimelineRecord,
  BbNativeFileChange,
  BbNativeSessionSnapshot,
  BbOptimisticUserMessage,
  BbSessionPaginationState,
  BbSessionSurface,
  BbSessionSurfaceOptions,
  BbSessionRuntimeState,
  BbTheme,
} from './contracts'
