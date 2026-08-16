import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  FileDiff as PierreFileDiff,
  getSingularPatch,
  parseDiffFromFile,
  type FileContents,
  type FileDiffMetadata,
  type FileDiffOptions,
  type PostRenderPhase,
} from '@pierre/diffs'
import { Editor, type EditorOptions } from '@pierre/diffs/edit'
import { Icon } from '@iconify/react'
import {
  AddLine,
  Back2Line,
} from '@mingcute/react'
import { AppButton } from '@/components/app-button'
import { AppIconButton } from '@/components/app-icon-button'
import { AppLoadingState } from '@/components/app-loading-state'
import { AppScrollArea } from '@/components/app-scroll-area'
import { EMPTY_STATE_ICONS, EmptyState } from '@/components/empty-state'
import {
  ViewerToolbar,
  ViewerToolbarGroup,
} from '@/components/ui/document-viewer-controls'
import {
  SegmentedTabs,
  type SegmentedTabOption,
} from '@/components/ui/segmented-tabs/segmented-tabs'
import {
  getGitFileDiffPresentation,
  isEditableGitFileDiff,
  type GitChangeItem,
  type GitDiffImage,
  type GitDiffSelection,
  type GitFileDiffPresentation,
  type GitFileDiffResult,
} from '@/features/git/types'
import type { WorkspaceDiffNavigationRequest } from '@/features/workspace/store/use-workspace-store'
import type { AppTheme } from '@/hooks/use-settings-store'
import { getPierreDiffLanguage } from '@/lib/pierre-diffs-language'
import {
  getImageComparisonStageDimensions,
  getImageOverlayStageStyle,
  getImageVersionPresentation,
  imageMayContainTransparency,
  type ImageDiffSide,
  type ImageNaturalDimensions,
  type ImageVersionPresentation,
} from './image-diff-model'
import './styles.css'

type DiffNavigationSide = 'modified' | 'original'

type DiffNavigationTarget = {
  lineNumber: number
  side: DiffNavigationSide
}

const DIFFS_THEMES = {
  dark: 'pierre-dark',
  light: 'pierre-light',
} as const

export const DIFF_UNSAFE_CSS = `
:host {
  --diffs-font-family: var(--font-mono);
  --diffs-font-features: "liga" 0, "calt" 0;
  --diffs-font-size: 13px;
  --diffs-line-height: 21px;
  --diffs-gap-block: 0px;
  --diffs-gap-inline: 10px;
  --diffs-light-bg: var(--background-primary);
  --diffs-dark-bg: var(--background-primary);
  --diffs-light: var(--foreground-primary);
  --diffs-dark: var(--foreground-primary);
  --diffs-bg-context-override: var(--background-secondary);
  --diffs-bg-separator-override: var(--background-tertiary);
  --diffs-fg-number-override: var(--foreground-tertiary);
}

/*
 * Pierre positions its editable caret and selection with a fixed ASCII
 * character width. Keep the rendered text on that same metric grid. Its
 * split/wrap editor also double-counts an internal block gap, so vertical
 * breathing room lives outside the shadow tree instead.
 */
pre,
code,
[data-content] {
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0, "calt" 0;
  letter-spacing: 0;
  text-rendering: auto;
}

[data-navigation-target] {
  --diffs-line-bg: var(--accent-soft) !important;
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--accent) 72%, transparent);
}
`

const PIERRE_RENDER_TIMEOUT_MS = 15_000

function getGitActionsDisabledReason(options: {
  isComposing: boolean
  isSaving: boolean
}) {
  if (options.isSaving) {
    return 'Wait for the current file action to finish first.'
  }

  if (options.isComposing) {
    return 'Finish the current IME composition first.'
  }

  return null
}

function getSelectionLineStart(selection: GitDiffSelection, side: DiffNavigationSide) {
  return Math.max(1, side === 'modified' ? selection.modifiedStartLine : selection.originalStartLine)
}

function getSelectionLineCount(selection: GitDiffSelection, side: DiffNavigationSide) {
  return side === 'modified' ? selection.modifiedLineCount : selection.originalLineCount
}

function getDistanceToLineRange(lineNumber: number, startLine: number, lineCount: number) {
  const normalizedStartLine = Math.max(1, startLine)

  if (lineCount <= 0) {
    return Math.abs(lineNumber - normalizedStartLine)
  }

  const endLine = normalizedStartLine + lineCount - 1

  if (lineNumber < normalizedStartLine) return normalizedStartLine - lineNumber
  if (lineNumber > endLine) return lineNumber - endLine
  return 0
}

function clampLineToSelection(
  selection: GitDiffSelection,
  side: DiffNavigationSide,
  lineNumber: number,
) {
  const startLine = getSelectionLineStart(selection, side)
  const count = getSelectionLineCount(selection, side)
  const endLine = count > 0 ? startLine + count - 1 : startLine
  return Math.max(startLine, Math.min(Math.floor(lineNumber), endLine))
}

function resolveNavigationTarget(
  selections: GitDiffSelection[],
  requestedLineNumber: number,
  preferredSide: DiffNavigationSide,
): DiffNavigationTarget {
  let bestTarget: DiffNavigationTarget | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const selection of selections) {
    const fallbackSide = preferredSide === 'modified' ? 'original' : 'modified'
    const preferredCount = getSelectionLineCount(selection, preferredSide)
    const fallbackCount = getSelectionLineCount(selection, fallbackSide)
    const preferredDistance = getDistanceToLineRange(
      requestedLineNumber,
      getSelectionLineStart(selection, preferredSide),
      preferredCount,
    )
    const fallbackDistance = getDistanceToLineRange(
      requestedLineNumber,
      getSelectionLineStart(selection, fallbackSide),
      fallbackCount,
    )
    const side = preferredCount <= 0 && fallbackCount > 0
      ? fallbackSide
      : fallbackCount > 0 && fallbackDistance < preferredDistance
        ? fallbackSide
        : preferredSide
    const distance = side === preferredSide ? preferredDistance : fallbackDistance

    if (distance < bestDistance) {
      bestDistance = distance
      bestTarget = {
        lineNumber: clampLineToSelection(selection, side, requestedLineNumber),
        side,
      }
    }
  }

  return bestTarget ?? {
    lineNumber: Math.max(1, Math.floor(requestedLineNumber)),
    side: preferredSide,
  }
}

function revealNavigationTarget(node: HTMLElement, target: DiffNavigationTarget) {
  const root = node.shadowRoot ?? node
  root.querySelectorAll('[data-navigation-target]').forEach((element) => {
    element.removeAttribute('data-navigation-target')
  })

  const column = target.side === 'modified' ? 'additions' : 'deletions'
  const selector = `[data-${column}] [data-line="${target.lineNumber}"]`
  const line = root.querySelector<HTMLElement>(selector)

  if (!line) {
    return false
  }

  line.setAttribute('data-navigation-target', '')
  line.closest('[data-code]')?.querySelectorAll<HTMLElement>(
    `[data-column-number="${target.lineNumber}"]`,
  ).forEach((number) => {
    number.setAttribute('data-navigation-target', '')
  })
  line.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'center',
    inline: 'nearest',
  })
  return true
}

function getThemeType(theme: AppTheme) {
  return theme === 'auto' ? 'system' : theme
}

function createDiffFile(
  name: string,
  contents: string,
): FileContents {
  return {
    contents,
    lang: getPierreDiffLanguage(name),
    name,
  }
}

type PierreDiffSurfaceStatus =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error' }

function PierreDiffSurface({
  edit,
  editorOptions,
  fileDiff,
  options,
}: {
  edit: boolean
  editorOptions: EditorOptions<undefined>
  fileDiff: FileDiffMetadata
  options: FileDiffOptions<undefined>
}) {
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<PierreDiffSurfaceStatus>({ kind: 'loading' })
  const hostRef = useRef<HTMLDivElement | null>(null)
  const instanceRef = useRef<PierreFileDiff<undefined> | null>(null)
  const renderTimeoutRef = useRef<number | null>(null)
  const editRef = useRef(edit)
  const editorOptionsRef = useRef(editorOptions)
  const fileDiffRef = useRef(fileDiff)
  const optionsRef = useRef(options)

  editRef.current = edit
  editorOptionsRef.current = editorOptions
  fileDiffRef.current = fileDiff
  optionsRef.current = options

  const clearRenderTimeout = useCallback(() => {
    if (renderTimeoutRef.current === null) return
    window.clearTimeout(renderTimeoutRef.current)
    renderTimeoutRef.current = null
  }, [])

  const handlePostRender = useCallback((
    node: HTMLElement,
    instance: PierreFileDiff<undefined>,
    phase: PostRenderPhase,
  ) => {
    node.classList.add('git-diff-pierre-file')
    optionsRef.current.onPostRender?.(node, instance, phase)
    if (phase === 'unmount') return

    clearRenderTimeout()
    setStatus({ kind: 'ready' })
  }, [clearRenderTimeout])

  const resolvedOptions = useMemo<FileDiffOptions<undefined>>(() => ({
    ...options,
    onPostRender: handlePostRender,
  }), [handlePostRender, options])
  const resolvedOptionsRef = useRef(resolvedOptions)
  resolvedOptionsRef.current = resolvedOptions

  useEffect(() => {
    const containerWrapper = hostRef.current
    if (!containerWrapper) return

    let disposed = false
    let instance: PierreFileDiff<undefined> | null = null
    let editor: Editor<undefined> | null = null
    let stopEditing: (() => void) | null = null

    setStatus({ kind: 'loading' })
    clearRenderTimeout()

    // StrictMode performs an initial setup/cleanup probe in development.
    // Pierre 1.3.5 does not survive that synchronous lifecycle, so mount it
    // after the probe instead of disabling StrictMode for the entire app.
    const startTimeout = window.setTimeout(() => {
      if (disposed) return

      renderTimeoutRef.current = window.setTimeout(() => {
        if (!disposed) setStatus({ kind: 'error' })
      }, PIERRE_RENDER_TIMEOUT_MS)

      try {
        // Let Pierre create its registered <diffs-container>. Supplying our
        // plain React div as fileContainer skips Pierre's base shadow styles.
        instance = new PierreFileDiff(resolvedOptionsRef.current)
        instanceRef.current = instance
        instance.render({
          containerWrapper,
          fileDiff: fileDiffRef.current,
        })

        if (editRef.current) {
          editor = new Editor(editorOptionsRef.current)
          stopEditing = editor.edit(instance)
        }
      } catch (error) {
        console.error('Failed to mount the Pierre diff surface.', error)
        clearRenderTimeout()
        if (stopEditing) stopEditing()
        else editor?.cleanUp()

        stopEditing = null
        editor = null
        if (instanceRef.current === instance) instanceRef.current = null
        instance?.cleanUp()
        instance = null
        setStatus({ kind: 'error' })
      }
    }, 0)

    return () => {
      disposed = true
      window.clearTimeout(startTimeout)
      clearRenderTimeout()
      if (stopEditing) stopEditing()
      else editor?.cleanUp()

      if (instanceRef.current === instance) instanceRef.current = null
      instance?.cleanUp()
    }
  }, [attempt, clearRenderTimeout])

  useEffect(() => {
    const instance = instanceRef.current
    if (!instance) return

    try {
      instance.setOptions(resolvedOptions)
      instance.render({
        fileDiff,
        forceRender: true,
      })
    } catch (error) {
      console.error('Failed to update the Pierre diff surface.', error)
      clearRenderTimeout()
      setStatus({ kind: 'error' })
    }
  }, [clearRenderTimeout, fileDiff, resolvedOptions])

  return (
    <div className='git-diff-pierre-surface' data-render-status={status.kind}>
      <div ref={hostRef} className='git-diff-pierre-mount' />

      {status.kind === 'loading' ? (
        <AppLoadingState fill className='git-diff-render-loading' label='正在准备差异…' />
      ) : status.kind === 'error' ? (
        <EmptyState
          className='git-diff-render-error'
          description='请重试；如果问题持续出现，可以重新打开该差异。'
          icon={EMPTY_STATE_ICONS.renderError}
          role='alert'
          title='差异渲染失败'
          actions={(
            <AppButton size='sm' variant='outline' onClick={() => setAttempt((value) => value + 1)}>
              重试
            </AppButton>
          )}
        />
      ) : null}
    </div>
  )
}

function PierreTextDiff({
  diff,
  initialDraftContent,
  isEditable,
  navigationRequest,
  onCompositionChange,
  onDraftChange,
  onSave,
  theme,
}: {
  diff: GitFileDiffResult
  initialDraftContent: string
  isEditable: boolean
  navigationRequest: WorkspaceDiffNavigationRequest | null
  onCompositionChange: (isComposing: boolean) => void
  onDraftChange: (content: string) => void
  onSave: () => void
  theme: AppTheme
}) {
  const [surfaceModifiedContent, setSurfaceModifiedContent] = useState(initialDraftContent)
  const draftContentRef = useRef(initialDraftContent)
  const lastBaselineRef = useRef(diff.modifiedContent)
  const lastHandledNavigationRequestKeyRef = useRef<string | null>(null)
  const surfaceNodeRef = useRef<HTMLElement | null>(null)
  const onCompositionChangeRef = useRef(onCompositionChange)
  const onDraftChangeRef = useRef(onDraftChange)
  const onSaveRef = useRef(onSave)

  useEffect(() => {
    onCompositionChangeRef.current = onCompositionChange
  }, [onCompositionChange])

  useEffect(() => {
    onDraftChangeRef.current = onDraftChange
  }, [onDraftChange])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    if (lastBaselineRef.current === diff.modifiedContent) {
      return
    }

    lastBaselineRef.current = diff.modifiedContent
    draftContentRef.current = initialDraftContent
    setSurfaceModifiedContent(initialDraftContent)
  }, [diff.modifiedContent, initialDraftContent])

  useEffect(() => () => {
    onCompositionChangeRef.current(false)
  }, [])

  const handleKeyDown = useCallback((event: Event) => {
    if (!(event instanceof KeyboardEvent)) return
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
    if (event.key.toLowerCase() !== 's') return

    event.preventDefault()
    onSaveRef.current()
  }, [])

  const handleCompositionStart = useCallback(() => {
    onCompositionChangeRef.current(true)
  }, [])

  const handleCompositionEnd = useCallback(() => {
    onCompositionChangeRef.current(false)
  }, [])

  const handlePostRender = useCallback((
    node: HTMLElement,
    phase: PostRenderPhase,
  ) => {
    if (phase === 'mount') {
      surfaceNodeRef.current = node
      node.addEventListener('keydown', handleKeyDown)
      node.addEventListener('compositionstart', handleCompositionStart)
      node.addEventListener('compositionend', handleCompositionEnd)
    } else if (phase === 'unmount') {
      node.removeEventListener('keydown', handleKeyDown)
      node.removeEventListener('compositionstart', handleCompositionStart)
      node.removeEventListener('compositionend', handleCompositionEnd)
      if (surfaceNodeRef.current === node) surfaceNodeRef.current = null
      return
    }

    if (
      !navigationRequest
      || lastHandledNavigationRequestKeyRef.current === navigationRequest.requestKey
    ) {
      return
    }

    const target = resolveNavigationTarget(
      diff.selections,
      navigationRequest.lineNumber,
      navigationRequest.source === 'revision' ? 'original' : 'modified',
    )

    window.requestAnimationFrame(() => {
      if (revealNavigationTarget(node, target)) {
        lastHandledNavigationRequestKeyRef.current = navigationRequest.requestKey
      }
    })
  }, [
    diff.selections,
    handleCompositionEnd,
    handleCompositionStart,
    handleKeyDown,
    navigationRequest,
  ])

  const fileDiff = useMemo(() => {
    const presentation = getGitFileDiffPresentation(diff)
    if (presentation.kind === 'converted-text' || presentation.kind === 'patch-text') {
      const patchDiff = getSingularPatch(presentation.patch)
      patchDiff.lang = 'text'
      return patchDiff
    }

    const originalName = diff.change.originalPath ?? diff.change.path
    const originalFile = diff.originalExists
      ? createDiffFile(
        originalName,
        diff.originalContent,
      )
      : null
    const modifiedFile = diff.modifiedExists
      ? createDiffFile(
        diff.change.path,
        surfaceModifiedContent,
      )
      : null

    return parseDiffFromFile(originalFile, modifiedFile)
  }, [
    diff.change.originalPath,
    diff.change.path,
    diff.modifiedExists,
    diff.originalContent,
    diff.originalExists,
    diff.presentation,
    surfaceModifiedContent,
  ])

  const diffOptions = useMemo<FileDiffOptions<undefined>>(() => ({
    collapsedContextThreshold: 16,
    diffIndicators: 'bars',
    diffStyle: 'split',
    disableFileHeader: true,
    expandUnchanged: false,
    hunkSeparators: 'line-info',
    lineDiffType: 'word-alt',
    onPostRender: (node, _instance, phase) => {
      handlePostRender(node, phase)
    },
    overflow: 'wrap',
    theme: DIFFS_THEMES,
    themeType: getThemeType(theme),
    tokenizeMaxLength: 1_500_000,
    tokenizeMaxLineLength: 2_000,
    unsafeCSS: DIFF_UNSAFE_CSS,
  }), [handlePostRender, theme])

  const editorOptions = useMemo<EditorOptions<undefined>>(() => ({
    historyMaxEntries: 100,
    onChange(file) {
      if (file.contents === draftContentRef.current) return
      draftContentRef.current = file.contents
      onDraftChangeRef.current(file.contents)
    },
    roundedSelection: false,
  }), [])
  const surfaceKey = [
    diff.source.kind === 'commit' ? diff.source.commit.hash : 'working-tree',
    diff.change.scope,
    diff.change.path,
    isEditable ? 'edit' : 'read',
  ].join(':')

  return (
    <AppScrollArea
      className='git-diff-scroll-area'
      contentClassName='git-diff-pierre-content'
      viewportClassName='git-diff-pierre-viewport'
    >
      <PierreDiffSurface
        key={surfaceKey}
        edit={isEditable}
        editorOptions={editorOptions}
        fileDiff={fileDiff}
        options={diffOptions}
      />
    </AppScrollArea>
  )
}

const BYTE_FORMATTER = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 1,
})

function formatByteSize(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`
  if (byteSize < 1024 * 1024) return `${BYTE_FORMATTER.format(byteSize / 1024)} KB`
  return `${BYTE_FORMATTER.format(byteSize / (1024 * 1024))} MB`
}

function ImageVersionCaptionContent({
  dimensions,
  image,
  presentation,
}: {
  dimensions: ImageNaturalDimensions | null
  image: GitDiffImage
  presentation: ImageVersionPresentation
}) {
  return (
    <>
      <span className='git-diff-image-caption-label'>
        <span className='git-diff-image-status'>{presentation.statusLabel}</span>
        <span className='git-diff-image-source'>{presentation.sourceLabel}</span>
      </span>
      <span className='git-diff-image-metadata'>
        {dimensions ? `${dimensions.width} × ${dimensions.height} · ` : ''}
        {formatByteSize(image.byteSize)}
      </span>
    </>
  )
}

function ImageVersion({
  image,
  onDimensionsChange,
  presentation,
  side,
}: {
  image: GitDiffImage
  onDimensionsChange: (side: ImageDiffSide, dimensions: ImageNaturalDimensions) => void
  presentation: ImageVersionPresentation
  side: ImageDiffSide
}) {
  const [dimensions, setDimensions] = useState<ImageNaturalDimensions | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    setDimensions(null)
    setLoadFailed(false)
  }, [image.dataUrl])

  return (
    <figure className='git-diff-image-version'>
      <figcaption className='git-diff-image-caption' data-tone={presentation.tone}>
        <ImageVersionCaptionContent
          dimensions={dimensions}
          image={image}
          presentation={presentation}
        />
      </figcaption>
      <div
        className='git-diff-image-canvas'
        data-checkerboard={imageMayContainTransparency(image) ? '' : undefined}
      >
        {loadFailed ? (
          <EmptyState
            className='git-diff-image-error'
            description='图片数据可能已损坏，或当前运行环境无法解码此格式。'
            icon={EMPTY_STATE_ICONS.imageUnavailable}
            role='status'
            title='无法预览此图片'
          />
        ) : (
          <img
            alt={presentation.accessibleLabel}
            decoding='async'
            draggable='false'
            src={image.dataUrl}
            onError={() => setLoadFailed(true)}
            onLoad={(event) => {
              const element = event.currentTarget
              const nextDimensions = {
                height: element.naturalHeight,
                width: element.naturalWidth,
              }
              setDimensions(nextDimensions)
              onDimensionsChange(side, nextDimensions)
            }}
          />
        )}
      </div>
    </figure>
  )
}

type ImageDiffMode = 'difference' | 'onion-skin' | 'swipe' | 'two-up'

const IMAGE_DIFF_MODES = [
  { label: '并排', value: 'two-up', tooltip: '并排显示两个版本' },
  { label: '滑动', value: 'swipe', tooltip: '拖动分割线比较两个版本' },
  { label: '叠加', value: 'onion-skin', tooltip: '叠加两个版本并调整修改后版本的透明度' },
  { label: '差异', value: 'difference', tooltip: '突出显示像素差异' },
] satisfies readonly SegmentedTabOption<ImageDiffMode>[]

function ImageDiffModePicker({
  mode,
  onChange,
}: {
  mode: ImageDiffMode
  onChange: (mode: ImageDiffMode) => void
}) {
  return (
    <SegmentedTabs<ImageDiffMode>
      ariaLabel='图片差异查看方式'
      options={IMAGE_DIFF_MODES}
      value={mode}
      onValueChange={onChange}
    />
  )
}

function ImageDiffComparisonBar({
  amount,
  dimensions,
  label,
  modified,
  modifiedPresentation,
  onChange,
  original,
  originalPresentation,
}: {
  amount: number
  dimensions: Record<ImageDiffSide, ImageNaturalDimensions | null>
  label: string
  modified: GitDiffImage
  modifiedPresentation: ImageVersionPresentation
  onChange: (amount: number) => void
  original: GitDiffImage
  originalPresentation: ImageVersionPresentation
}) {
  return (
    <div className='git-diff-image-comparison-bar'>
      <div
        className='git-diff-image-comparison-summary is-original'
        data-tone={originalPresentation.tone}
      >
        <ImageVersionCaptionContent
          dimensions={dimensions.original}
          image={original}
          presentation={originalPresentation}
        />
      </div>

      <label className='git-diff-image-range-control'>
        <span className='git-diff-image-range-label'>{label}</span>
        <input
          aria-label={label}
          max='100'
          min='0'
          type='range'
          value={amount}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <output>{amount}%</output>
      </label>

      <div
        className='git-diff-image-comparison-summary is-modified'
        data-tone={modifiedPresentation.tone}
      >
        <ImageVersionCaptionContent
          dimensions={dimensions.modified}
          image={modified}
          presentation={modifiedPresentation}
        />
      </div>
    </div>
  )
}

function OverlayImageDiff({
  amount,
  dimensions,
  mode,
  modified,
  modifiedPresentation,
  onDimensionsChange,
  original,
  originalPresentation,
}: {
  amount: number
  dimensions: Record<ImageDiffSide, ImageNaturalDimensions | null>
  mode: Exclude<ImageDiffMode, 'two-up'>
  modified: GitDiffImage
  modifiedPresentation: ImageVersionPresentation
  onDimensionsChange: (side: ImageDiffSide, dimensions: ImageNaturalDimensions) => void
  original: GitDiffImage
  originalPresentation: ImageVersionPresentation
}) {
  const [failedImage, setFailedImage] = useState<{
    dataUrl: string
    side: ImageDiffSide
  } | null>(null)
  const [stageBounds, setStageBounds] = useState<ImageNaturalDimensions | null>(null)
  const stageViewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stageViewport = stageViewportRef.current
    if (!stageViewport) return

    const updateStageBounds = () => {
      const nextBounds = {
        height: stageViewport.clientHeight,
        width: stageViewport.clientWidth,
      }
      setStageBounds((current) => (
        current?.height === nextBounds.height && current.width === nextBounds.width
          ? current
          : nextBounds
      ))
    }

    updateStageBounds()
    if (typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(updateStageBounds)
    resizeObserver.observe(stageViewport)
    return () => resizeObserver.disconnect()
  }, [])

  const handleImageLoad = useCallback((side: ImageDiffSide, element: HTMLImageElement) => {
    const nextDimensions = {
      height: element.naturalHeight,
      width: element.naturalWidth,
    }
    setFailedImage((current) => current?.side === side ? null : current)
    onDimensionsChange(side, nextDimensions)
  }, [onDimensionsChange])
  const stageDimensions = getImageComparisonStageDimensions(
    dimensions.original,
    dimensions.modified,
  )
  const stageStyle: CSSProperties | undefined = getImageOverlayStageStyle(
    stageDimensions,
    stageBounds,
  )
  const modifiedStyle: CSSProperties | undefined = mode === 'swipe'
    ? { clipPath: `inset(0 0 0 ${amount}%)` }
    : mode === 'onion-skin'
      ? { opacity: amount / 100 }
      : undefined
  const loadFailed = (
    failedImage?.side === 'original' && failedImage.dataUrl === original.dataUrl
  ) || (
    failedImage?.side === 'modified' && failedImage.dataUrl === modified.dataUrl
  )

  if (loadFailed) {
    return (
      <EmptyState
        className='git-diff-image-overlay-error'
        description='至少一个图片版本已损坏，或当前运行环境无法解码其格式。'
        icon={EMPTY_STATE_ICONS.imageUnavailable}
        role='status'
        title='无法比较这两个图片版本'
      />
    )
  }

  return (
    <div className='git-diff-image-overlay-view'>
      <div ref={stageViewportRef} className='git-diff-image-overlay-stage-viewport'>
        <div
          className='git-diff-image-overlay-stage'
          data-checkerboard={
            imageMayContainTransparency(original) || imageMayContainTransparency(modified)
              ? ''
              : undefined
          }
          data-mode={mode}
          data-ready={stageDimensions ? '' : undefined}
          style={stageStyle}
        >
          <img
            alt={originalPresentation.accessibleLabel}
            className='git-diff-image-overlay-layer is-original'
            decoding='async'
            draggable='false'
            src={original.dataUrl}
            onError={() => setFailedImage({ dataUrl: original.dataUrl, side: 'original' })}
            onLoad={(event) => handleImageLoad('original', event.currentTarget)}
          />
          <img
            alt={modifiedPresentation.accessibleLabel}
            className='git-diff-image-overlay-layer is-modified'
            decoding='async'
            draggable='false'
            src={modified.dataUrl}
            style={modifiedStyle}
            onError={() => setFailedImage({ dataUrl: modified.dataUrl, side: 'modified' })}
            onLoad={(event) => handleImageLoad('modified', event.currentTarget)}
          />
          {mode === 'swipe' ? (
            <span
              className='git-diff-image-swipe-divider'
              style={{ insetInlineStart: `${amount}%` }}
              aria-hidden='true'
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

type ImageDiffPresentation = Extract<GitFileDiffPresentation, { kind: 'image' }>

function ImageDiffViewContent({
  diff,
  mode,
  presentation,
}: {
  diff: GitFileDiffResult
  mode: ImageDiffMode
  presentation: ImageDiffPresentation
}) {
  const [overlayAmount, setOverlayAmount] = useState(50)
  const [dimensions, setDimensions] = useState<{
    modified: ImageNaturalDimensions | null
    original: ImageNaturalDimensions | null
  }>({ modified: null, original: null })

  useEffect(() => {
    setOverlayAmount(50)
    setDimensions({ modified: null, original: null })
  }, [presentation.modified?.dataUrl, presentation.original?.dataUrl])

  useEffect(() => {
    setOverlayAmount(50)
  }, [mode])

  const handleDimensionsChange = useCallback((
    side: ImageDiffSide,
    nextDimensions: ImageNaturalDimensions,
  ) => {
    setDimensions((current) => {
      const previous = current[side]
      if (
        previous?.height === nextDimensions.height
        && previous.width === nextDimensions.width
      ) {
        return current
      }

      return { ...current, [side]: nextDimensions }
    })
  }, [])

  const canCompare = Boolean(presentation.original && presentation.modified)
  const originalPresentation = getImageVersionPresentation(diff, 'original', canCompare)
  const modifiedPresentation = getImageVersionPresentation(diff, 'modified', canCompare)

  const images = [
    presentation.original
      ? {
          image: presentation.original,
          key: 'original' as const,
          presentation: originalPresentation,
        }
      : null,
    presentation.modified
      ? {
          image: presentation.modified,
          key: 'modified' as const,
          presentation: modifiedPresentation,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null)

  if (images.length === 0) {
    return (
      <EmptyState
        className='git-diff-unavailable'
        description='原始版本和修改版本都没有可供预览的图片内容。'
        icon={EMPTY_STATE_ICONS.image}
        title='没有可显示的图片版本'
      />
    )
  }

  const overlayControlLabel = mode === 'swipe' ? '分割位置' : '修改版本透明度'

  return (
    <div className='git-diff-image-shell'>
      {canCompare && mode !== 'two-up' && mode !== 'difference' ? (
        <ImageDiffComparisonBar
          amount={overlayAmount}
          dimensions={dimensions}
          label={overlayControlLabel}
          modified={presentation.modified!}
          modifiedPresentation={modifiedPresentation}
          onChange={setOverlayAmount}
          original={presentation.original!}
          originalPresentation={originalPresentation}
        />
      ) : null}

      <div
        aria-label='图片差异视图'
        className='git-diff-image-viewport'
        role='region'
      >
        <div
          className='git-diff-image-view'
          data-comparison={canCompare ? '' : undefined}
        >
          {canCompare && mode !== 'two-up' ? (
            <OverlayImageDiff
              amount={overlayAmount}
              dimensions={dimensions}
              mode={mode}
              modified={presentation.modified!}
              modifiedPresentation={modifiedPresentation}
              onDimensionsChange={handleDimensionsChange}
              original={presentation.original!}
              originalPresentation={originalPresentation}
            />
          ) : (
            <div
              className='git-diff-image-grid'
              data-single-image={images.length === 1 ? '' : undefined}
            >
              {images.map((item) => (
                <ImageVersion
                  key={item.key}
                  image={item.image}
                  onDimensionsChange={handleDimensionsChange}
                  presentation={item.presentation}
                  side={item.key}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ImageDiffView({
  diff,
  mode,
}: {
  diff: GitFileDiffResult
  mode: ImageDiffMode
}) {
  const presentation = getGitFileDiffPresentation(diff)
  if (presentation.kind !== 'image') return null

  return (
    <ImageDiffViewContent
      diff={diff}
      mode={mode}
      presentation={presentation}
    />
  )
}

function OpenDiffPathAction({
  label,
  path,
}: {
  label: string
  path: string
}) {
  const [status, setStatus] = useState<'error' | 'idle' | 'opening'>('idle')

  useEffect(() => {
    setStatus('idle')
  }, [path])

  const handleOpen = useCallback(async () => {
    if (status === 'opening') return

    setStatus('opening')
    try {
      await window.appApi.openPath(path)
      setStatus('idle')
    } catch (error) {
      console.error('Failed to open the diff path.', error)
      setStatus('error')
    }
  }, [path, status])

  return (
    <div className='git-diff-open-action'>
      <AppButton
        disabled={status === 'opening'}
        size='sm'
        variant='outline'
        onClick={() => void handleOpen()}
      >
        {status === 'opening' ? '正在打开…' : label}
      </AppButton>
      {status === 'error' ? (
        <span className='git-diff-open-error' role='alert'>
          无法打开；请确认该文件或文件夹仍然存在且可访问。
        </span>
      ) : null}
    </div>
  )
}

function BinaryDiffView({ diff }: { diff: GitFileDiffResult }) {
  const presentation = getGitFileDiffPresentation(diff)
  if (presentation.kind !== 'binary') return null

  const canOpenCurrentFile = diff.source.kind === 'working-tree' && diff.modifiedExists

  return (
    <EmptyState
      aria-live='polite'
      className='git-diff-unavailable'
      description={`Git 将此文件视为二进制内容（${formatByteSize(Math.max(
        presentation.originalByteSize,
        presentation.modifiedByteSize,
      ))}），因此没有可显示的逐行差异。文件级 Git 操作仍然可用。`}
      icon={EMPTY_STATE_ICONS.binaryFile}
      role='status'
      title='二进制文件已更改'
      actions={canOpenCurrentFile ? (
        <OpenDiffPathAction label='用系统默认程序打开' path={diff.change.path} />
      ) : null}
    />
  )
}

function formatSubmoduleCommit(commit: string | null) {
  return commit ? commit.slice(0, 8) : '无'
}

function SubmoduleDiffView({ diff }: { diff: GitFileDiffResult }) {
  const presentation = getGitFileDiffPresentation(diff)
  if (presentation.kind !== 'submodule') return null

  const { modifiedCommit, originalCommit, url, workingTree } = presentation
  const canOpenSubmodule = diff.source.kind === 'working-tree' && diff.modifiedExists
  const pointerChanged = originalCommit !== modifiedCommit
  const workingTreeChanges = [
    workingTree?.modifiedChanges ? '已修改内容' : null,
    workingTree?.untrackedChanges ? '未跟踪文件' : null,
  ].filter((value): value is string => Boolean(value))
  const title = originalCommit && modifiedCommit && pointerChanged
    ? '子模块提交已更新'
    : !originalCommit && modifiedCommit
      ? '新增了子模块'
      : originalCommit && !modifiedCommit
        ? '删除了子模块'
        : workingTreeChanges.length > 0
          ? '子模块包含未提交更改'
          : '子模块状态已变化'

  return (
    <EmptyState
      aria-live='polite'
      className='git-diff-unavailable git-diff-submodule'
      description={(
        <>
          <span>
            提交指针：
            <code title={originalCommit ?? undefined}>{formatSubmoduleCommit(originalCommit)}</code>
            {' → '}
            <code title={modifiedCommit ?? undefined}>{formatSubmoduleCommit(modifiedCommit)}</code>
          </span>
          {workingTreeChanges.length > 0 ? (
            <>
              <br />
              <span>子模块工作树包含{workingTreeChanges.join('和')}，需要在子模块仓库内处理。</span>
            </>
          ) : null}
          {url ? (
            <>
              <br />
              <span className='git-diff-submodule-url'>远程地址：{url}</span>
            </>
          ) : null}
        </>
      )}
      icon={EMPTY_STATE_ICONS.repository}
      role='status'
      title={title}
      actions={canOpenSubmodule ? (
        <OpenDiffPathAction label='打开子模块文件夹' path={diff.change.path} />
      ) : null}
    />
  )
}

function DiffUnavailableState({ diff }: { diff: GitFileDiffResult }) {
  const presentation = getGitFileDiffPresentation(diff)
  let description = '这个文件没有可显示的逐行差异。'
  let title = '无法显示差异'
  let icon: string = EMPTY_STATE_ICONS.unavailable

  if (presentation.kind === 'too-large') {
    title = '文件过大，无法安全显示'
    description = `较大的版本为 ${formatByteSize(Math.max(
      presentation.originalByteSize,
      presentation.modifiedByteSize,
    ))}，超过此类型的安全读取上限。文件级 Git 操作仍然可用。`
    icon = EMPTY_STATE_ICONS.warning
  } else if (presentation.kind === 'unsupported') {
    if (presentation.reason === 'submodule') {
      title = '子模块变更不支持内容差异'
      description = '子模块只记录提交指针。请在对应子模块仓库中查看实际内容变化。'
      icon = EMPTY_STATE_ICONS.folder
    } else if (presentation.reason === 'type-change') {
      title = '文件类型发生变化'
      description = '两个版本需要不同的查看方式，无法在同一比较视图中可靠呈现。'
      icon = EMPTY_STATE_ICONS.multipleFiles
    } else {
      title = '无法读取文件内容'
      description = '文件可能已移动、权限受限，或 Git 对象暂时不可用。刷新仓库状态后可以重试。'
      icon = EMPTY_STATE_ICONS.unreadable
    }
  }

  return (
    <EmptyState
      aria-live='polite'
      className='git-diff-unavailable'
      description={description}
      icon={icon}
      role='status'
      title={title}
    />
  )
}

function LargeTextDiffView({
  diff,
  navigationRequest,
  theme,
}: {
  diff: GitFileDiffResult
  navigationRequest: WorkspaceDiffNavigationRequest | null
  theme: AppTheme
}) {
  const [showDiff, setShowDiff] = useState(false)
  const presentation = getGitFileDiffPresentation(diff)

  if (presentation.kind !== 'large-text') return null

  if (showDiff) {
    return (
      <PierreTextDiff
        diff={diff}
        initialDraftContent={diff.modifiedContent}
        isEditable={false}
        navigationRequest={navigationRequest}
        theme={theme}
        onCompositionChange={() => undefined}
        onDraftChange={() => undefined}
        onSave={() => undefined}
      />
    )
  }

  return (
    <EmptyState
      className='git-diff-unavailable'
      description={`较大的版本为 ${formatByteSize(Math.max(
          presentation.originalByteSize,
          presentation.modifiedByteSize,
        ))}。直接渲染可能短暂影响性能。`}
      icon={EMPTY_STATE_ICONS.warning}
      title='这是一个较大的文本差异'
      actions={(
        <AppButton size='sm' variant='outline' onClick={() => setShowDiff(true)}>
          仍然显示
        </AppButton>
      )}
    />
  )
}

function PatchBackedTextDiffView({
  diff,
  navigationRequest,
  theme,
}: {
  diff: GitFileDiffResult
  navigationRequest: WorkspaceDiffNavigationRequest | null
  theme: AppTheme
}) {
  const presentation = getGitFileDiffPresentation(diff)
  const [showLargeDiff, setShowLargeDiff] = useState(false)

  if (presentation.kind !== 'converted-text' && presentation.kind !== 'patch-text') return null

  if (presentation.isLarge && !showLargeDiff) {
    const isConverted = presentation.kind === 'converted-text'

    return (
      <EmptyState
        className='git-diff-unavailable'
        description={isConverted
          ? `Git 文本转换器“${presentation.driver}”生成了 ${formatByteSize(
              presentation.patchByteSize,
            )} 的差异。直接渲染可能短暂影响性能。`
          : `差异补丁为 ${formatByteSize(
              presentation.patchByteSize,
            )}。直接渲染可能短暂影响性能。`}
        icon={EMPTY_STATE_ICONS.warning}
        title='这是一个较大的文本差异'
        actions={(
          <AppButton size='sm' variant='outline' onClick={() => setShowLargeDiff(true)}>
            仍然显示
          </AppButton>
        )}
      />
    )
  }

  return (
    <PierreTextDiff
      diff={diff}
      initialDraftContent=''
      isEditable={false}
      navigationRequest={navigationRequest}
      theme={theme}
      onCompositionChange={() => undefined}
      onDraftChange={() => undefined}
      onSave={() => undefined}
    />
  )
}

function DiffHeader({
  areFileGitActionsEnabled,
  centerToolbarAction,
  diff,
  leadingToolbarAction,
  onDiscardChange,
  onStageChange,
  onUnstageChange,
}: {
  areFileGitActionsEnabled: boolean
  centerToolbarAction: ReactNode
  diff: GitFileDiffResult
  leadingToolbarAction: ReactNode
  onDiscardChange: (change: GitChangeItem) => void
  onStageChange: (change: GitChangeItem) => void
  onUnstageChange: (change: GitChangeItem) => void
}) {
  const isWorkingTreeDiff = diff.source.kind === 'working-tree'
  const presentation = getGitFileDiffPresentation(diff)

  return (
    <ViewerToolbar
      as='header'
      aria-label='文件差异工具栏'
      className='git-diff-header'
      data-has-center-action={centerToolbarAction ? '' : undefined}
    >
      <ViewerToolbarGroup className='git-diff-header-start'>
        {leadingToolbarAction ? (
          <div className='git-diff-header-leading-slot'>
            {leadingToolbarAction}
          </div>
        ) : null}
        <div className='viewer-toolbar-title git-diff-header-title-area'>
          <h3 className='git-diff-header-title' title={diff.change.relativePath}>
            {diff.change.relativePath}
          </h3>
          {presentation.kind === 'submodule' ? (
            <span className='git-diff-header-kind' aria-label='差异类型：子模块'>
              <Icon icon='mingcute:git-branch-line' aria-hidden='true' />
              子模块
            </span>
          ) : null}
        </div>
      </ViewerToolbarGroup>

      {centerToolbarAction ? (
        <ViewerToolbarGroup className='git-diff-header-center-action'>
          {centerToolbarAction}
        </ViewerToolbarGroup>
      ) : null}

      <ViewerToolbarGroup align='end' className='git-diff-header-actions'>
        {isWorkingTreeDiff ? (
          diff.change.scope === 'unstaged' ? (
            <>
              <AppIconButton
                type='button'
                aria-label='放弃更改'
                tooltip='放弃更改'
                disabled={!areFileGitActionsEnabled}
                onClick={() => onDiscardChange(diff.change)}
              >
                <Back2Line aria-hidden='true' />
              </AppIconButton>
              <AppIconButton
                type='button'
                aria-label='暂存更改'
                tooltip='暂存'
                disabled={!areFileGitActionsEnabled}
                onClick={() => onStageChange(diff.change)}
              >
                <AddLine aria-hidden='true' />
              </AppIconButton>
            </>
          ) : (
            <AppIconButton
              type='button'
              aria-label='取消暂存'
              tooltip='取消暂存'
              disabled={!areFileGitActionsEnabled}
              onClick={() => onUnstageChange(diff.change)}
            >
              <Icon icon='mdi:minus' aria-hidden='true' />
            </AppIconButton>
          )
        ) : null}
      </ViewerToolbarGroup>
    </ViewerToolbar>
  )
}

export function GitDiffEditor({
  diff,
  draftContent: initialDraftContent,
  hasDirtyRelatedFileTab = false,
  leadingToolbarAction = null,
  navigationRequest = null,
  onDiscardChange,
  onDraftChange: onDraftContentChange,
  onSaveEditedFile,
  onStageChange,
  onUnstageChange,
  theme = 'auto',
}: {
  diff: GitFileDiffResult
  draftContent: string
  hasDirtyRelatedFileTab?: boolean
  leadingToolbarAction?: ReactNode
  navigationRequest?: WorkspaceDiffNavigationRequest | null
  onDiscardChange: (change: GitChangeItem) => void
  onDraftChange: (content: string) => void
  onSaveEditedFile: (filePath: string, content: string) => Promise<void>
  onStageChange: (change: GitChangeItem) => void
  onUnstageChange: (change: GitChangeItem) => void
  theme?: AppTheme
}) {
  const [isComposing, setIsComposing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [imageDiffMode, setImageDiffMode] = useState<ImageDiffMode>('two-up')
  const draftContentRef = useRef(initialDraftContent)
  const isComposingRef = useRef(false)
  const isSavingRef = useRef(false)
  const latestModifiedContentRef = useRef(diff.modifiedContent)
  const presentation = getGitFileDiffPresentation(diff)
  const hasTextContentDifference = diff.originalContent !== diff.modifiedContent
  const emptyTextDiff = !diff.originalExists && diff.modifiedExists
    ? {
        description: '文件已经创建，但还没有任何文本内容。',
        title: '新增了一个空文件',
      }
    : diff.originalExists && !diff.modifiedExists
      ? {
          description: '文件已经删除；删除前该文件没有任何文本内容。',
          title: '删除了一个空文件',
        }
      : {
          description: '这通常表示文件仅发生了重命名、权限或其他元数据变化。',
          title: '文件内容没有变化',
        }
  const isEditable = diff.source.kind === 'working-tree'
    && diff.change.scope === 'unstaged'
    && diff.modifiedExists
    && isEditableGitFileDiff(diff)
  const areFileGitActionsEnabled = getGitActionsDisabledReason({
    isComposing,
    isSaving,
  }) === null
  const canCompareImages = presentation.kind === 'image'
    && Boolean(presentation.original && presentation.modified)

  useEffect(() => {
    draftContentRef.current = initialDraftContent
  }, [initialDraftContent])

  useEffect(() => {
    latestModifiedContentRef.current = diff.modifiedContent
  }, [diff.modifiedContent])

  useEffect(() => {
    setImageDiffMode('two-up')
  }, [
    diff.change.path,
    presentation.kind === 'image' ? presentation.modified?.dataUrl : null,
    presentation.kind === 'image' ? presentation.original?.dataUrl : null,
  ])

  useEffect(() => {
    isSavingRef.current = isSaving
  }, [isSaving])

  useEffect(() => {
    setIsComposing(false)
    isComposingRef.current = false
  }, [diff.change.path, diff.change.scope])

  const handleCompositionChange = useCallback((nextValue: boolean) => {
    isComposingRef.current = nextValue
    setIsComposing((current) => current === nextValue ? current : nextValue)
  }, [])

  const handleDraftChange = useCallback((content: string) => {
    draftContentRef.current = content
    onDraftContentChange(content)
  }, [onDraftContentChange])

  const handleSave = useCallback(async () => {
    if (
      !isEditable
      || hasDirtyRelatedFileTab
      || isComposingRef.current
      || isSavingRef.current
      || draftContentRef.current === latestModifiedContentRef.current
    ) {
      return
    }

    setIsSaving(true)
    isSavingRef.current = true

    try {
      await onSaveEditedFile(diff.change.path, draftContentRef.current)
      latestModifiedContentRef.current = draftContentRef.current
    } finally {
      isSavingRef.current = false
      setIsSaving(false)
    }
  }, [diff.change.path, hasDirtyRelatedFileTab, isEditable, onSaveEditedFile])

  return (
    <div className='git-diff-editor'>
      <DiffHeader
        areFileGitActionsEnabled={areFileGitActionsEnabled}
        centerToolbarAction={canCompareImages ? (
          <ImageDiffModePicker
            mode={imageDiffMode}
            onChange={setImageDiffMode}
          />
        ) : null}
        diff={diff}
        leadingToolbarAction={leadingToolbarAction}
        onDiscardChange={onDiscardChange}
        onStageChange={onStageChange}
        onUnstageChange={onUnstageChange}
      />

      {presentation.kind === 'converted-text' || presentation.kind === 'patch-text' ? (
        <PatchBackedTextDiffView diff={diff} navigationRequest={navigationRequest} theme={theme} />
      ) : presentation.kind === 'text' ? (
        hasTextContentDifference ? (
          <PierreTextDiff
            diff={diff}
            initialDraftContent={initialDraftContent}
            isEditable={isEditable}
            navigationRequest={navigationRequest}
            theme={theme}
            onCompositionChange={handleCompositionChange}
            onDraftChange={handleDraftChange}
            onSave={() => {
              void handleSave()
            }}
          />
        ) : (
          <EmptyState
            className='git-diff-unavailable'
            description={emptyTextDiff.description}
            icon={EMPTY_STATE_ICONS.fileSuccess}
            title={emptyTextDiff.title}
          />
        )
      ) : presentation.kind === 'large-text' ? (
        <LargeTextDiffView diff={diff} navigationRequest={navigationRequest} theme={theme} />
      ) : presentation.kind === 'image' ? (
        <ImageDiffView
          diff={diff}
          mode={imageDiffMode}
        />
      ) : presentation.kind === 'binary' ? (
        <BinaryDiffView diff={diff} />
      ) : presentation.kind === 'submodule' ? (
        <SubmoduleDiffView diff={diff} />
      ) : (
        <DiffUnavailableState diff={diff} />
      )}
    </div>
  )
}
