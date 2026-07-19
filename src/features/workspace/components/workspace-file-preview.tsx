import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Fullscreen2Line } from '@mingcute/react'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { WorkspaceFileIcon } from '@/components/file-change-visuals'
import {
  ViewerToolbar,
  ViewerToolbarButton,
  ViewerToolbarGroup,
  ViewerToolbarSeparator,
  ViewerZoomControls,
} from '@/components/ui/document-viewer-controls'
import { HtmlPreview } from '@/features/editor/components/html-preview'
import { inferFileContentType } from '@/lib/file-content-types'
import type { GitRepositoryState } from '@/features/git/types'
import {
  getWorkspaceFileSystemContentType,
  shouldUseWorkspaceFileDataUrl,
} from '@/features/workspace/lib/workspace-file-system'
import {
  resolveWorkspaceFileRenderKindForEditorKind,
  type WorkspaceFileRenderKind,
} from '@/features/workspace/lib/workspace-file-rendering'
import { getBaseName } from '@/features/workspace/lib/workspace-paths'
import type { AppTheme, MeoSettings } from '@/hooks/use-settings-store'
import type { WorkspaceIconTheme } from '@/features/workspace/types'

const CodeEditor = lazy(async () => {
  const module = await import('@/features/editor/components/code-editor')
  return { default: module.CodeEditor }
})

const MeoEditorHost = lazy(async () => {
  const module = await import('@/features/editor/components/meo-editor-host')
  return { default: module.MeoEditorHost }
})

const CsvViewer = lazy(async () => {
  const module = await import('@/components/ui/csv-viewer')
  return { default: module.CsvViewer }
})

const PDFViewer = lazy(async () => {
  const module = await import('@/components/ui/pdf-viewer')
  return { default: module.PDFViewer }
})

const DocxViewerPreview = lazy(async () => {
  const module = await import('@/components/ui/docx-viewer')
  return { default: module.DocxViewerPreview }
})

const XlsxViewerPreview = lazy(async () => {
  const module = await import('@/components/ui/xlsx-viewer')
  return { default: module.XlsxViewerPreview }
})

const PptxViewerPreview = lazy(async () => {
  const module = await import('@/components/ui/pptx-viewer')
  return { default: module.PptxViewerPreview }
})

type WorkspaceFilePreviewProps = {
  filePath: string
  gitRepositoryState: GitRepositoryState | null
  iconTheme: WorkspaceIconTheme | null
  leadingToolbarActions?: ReactNode
  meoSettings: MeoSettings
  theme: AppTheme
  toolbarActions?: ReactNode
  workspacePath: string | null
}

type WorkspaceFileRendererProps = WorkspaceFilePreviewProps & {
  className?: string
  showToolbar?: boolean
}

type PreviewState =
  | { status: 'error'; message: string }
  | { status: 'loading' }
  | {
      content?: string
      kind: WorkspaceFileRenderKind
      status: 'ready'
      url: string | null
    }

const IMAGE_PREVIEW_WHEEL_STEP = 0.04
const IMAGE_PREVIEW_DOUBLE_CLICK_STEP = 0.4
const IMAGE_PREVIEW_ZOOM_ANIMATION_MS = 140
const IMAGE_PREVIEW_DEFAULT_ZOOM_PERCENT = 100
const IMAGE_PREVIEW_ZOOM_OPTIONS = [10, 25, 50, 75, 100, 125, 150, 175, 200, 400, 800] as const
const IMAGE_PREVIEW_MIN_SCALE = IMAGE_PREVIEW_ZOOM_OPTIONS[0] / 100
const IMAGE_PREVIEW_MAX_SCALE = IMAGE_PREVIEW_ZOOM_OPTIONS[IMAGE_PREVIEW_ZOOM_OPTIONS.length - 1] / 100

type ImagePreviewTransformState = {
  positionX: number
  positionY: number
  scale: number
}

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function calculateImagePreviewCenteredZoomTransform({
  currentTransformState,
  nextScale,
  viewportHeight,
  viewportWidth,
}: {
  currentTransformState: ImagePreviewTransformState
  nextScale: number
  viewportHeight: number
  viewportWidth: number
}): ImagePreviewTransformState {
  if (!viewportWidth || !viewportHeight || currentTransformState.scale === 0) {
    return {
      ...currentTransformState,
      scale: nextScale,
    }
  }

  const viewportCenterX = viewportWidth / 2
  const viewportCenterY = viewportHeight / 2
  const contentCenterX = (viewportCenterX - currentTransformState.positionX) / currentTransformState.scale
  const contentCenterY = (viewportCenterY - currentTransformState.positionY) / currentTransformState.scale

  return {
    positionX: viewportCenterX - contentCenterX * nextScale,
    positionY: viewportCenterY - contentCenterY * nextScale,
    scale: nextScale,
  }
}

export const __workspaceFilePreviewTestHooks = {
  calculateImagePreviewCenteredZoomTransform,
}

function PreviewToolbar({
  fileName,
  leadingActions,
  trailingActions,
}: {
  fileName: string
  leadingActions?: ReactNode
  trailingActions?: ReactNode
}) {
  return (
    <ViewerToolbar>
      {leadingActions ? <ViewerToolbarGroup>{leadingActions}</ViewerToolbarGroup> : null}
      <div className='viewer-toolbar-title'>{fileName}</div>
      {trailingActions ? (
        <ViewerToolbarGroup align='end'>{trailingActions}</ViewerToolbarGroup>
      ) : null}
    </ViewerToolbar>
  )
}

function PreviewLoadingState() {
  return (
    <div className='grid min-h-0 flex-1 place-items-center bg-[var(--background-primary)] text-sm text-[var(--foreground-secondary)]'>
      正在加载文件...
    </div>
  )
}

function PreviewUnavailableState({
  fileName,
  iconTheme,
  message,
}: {
  fileName: string
  iconTheme: WorkspaceIconTheme | null
  message: string
}) {
  return (
    <div className='grid min-h-0 flex-1 place-items-center bg-[var(--background-primary)] p-6 text-center'>
      <div className='flex max-w-sm flex-col items-center gap-3'>
        <div className='flex size-12 items-center justify-center text-[var(--foreground-secondary)] [--tree-item-icon-size:28px]'>
          <WorkspaceFileIcon fileName={fileName} iconTheme={iconTheme} />
        </div>
        <div className='space-y-1'>
          <div className='text-sm font-medium text-[var(--foreground-primary)]'>{fileName}</div>
          <p className='text-sm text-[var(--foreground-secondary)]'>{message}</p>
        </div>
      </div>
    </div>
  )
}

function ImagePreviewViewer({
  className,
  fileName,
  leadingToolbarActions,
  showToolbar,
  src,
  toolbarActions,
}: {
  className?: string
  fileName: string
  leadingToolbarActions?: ReactNode
  showToolbar: boolean
  src: string
  toolbarActions?: ReactNode
}) {
  const transformStateRef = useRef({
    positionX: 0,
    positionY: 0,
    scale: IMAGE_PREVIEW_DEFAULT_ZOOM_PERCENT / 100,
  })
  const zoomSurfaceRef = useRef<HTMLDivElement | null>(null)
  const [imageZoomPercent, setImageZoomPercentState] = useState(IMAGE_PREVIEW_DEFAULT_ZOOM_PERCENT)

  useEffect(() => {
    transformStateRef.current = {
      positionX: 0,
      positionY: 0,
      scale: IMAGE_PREVIEW_DEFAULT_ZOOM_PERCENT / 100,
    }
    setImageZoomPercentState(IMAGE_PREVIEW_DEFAULT_ZOOM_PERCENT)
  }, [src])

  function syncImageTransformState(transformState: ImagePreviewTransformState) {
    transformStateRef.current = transformState
    const nextZoomPercent = Math.round(transformState.scale * 100)

    setImageZoomPercentState((currentZoomPercent) =>
      currentZoomPercent === nextZoomPercent ? currentZoomPercent : nextZoomPercent
    )
  }

  return (
    <TransformWrapper
      key={src}
      centerOnInit
      doubleClick={{
        animationTime: IMAGE_PREVIEW_ZOOM_ANIMATION_MS,
        animationType: 'easeOut',
        mode: 'toggle',
        step: IMAGE_PREVIEW_DOUBLE_CLICK_STEP,
      }}
      limitToBounds={false}
      maxScale={IMAGE_PREVIEW_MAX_SCALE}
      minScale={IMAGE_PREVIEW_MIN_SCALE}
      onInit={(ref) => syncImageTransformState(ref.state)}
      onTransform={(_, transformState) => syncImageTransformState(transformState)}
      panning={{ velocityDisabled: true }}
      smooth={false}
      wheel={{ step: IMAGE_PREVIEW_WHEEL_STEP }}
    >
      {({ resetTransform, setTransform }) => {
        const setImageZoomPercent = (nextZoomPercent: number) => {
          const currentTransformState = transformStateRef.current
          const nextScale = nextZoomPercent / 100
          const zoomSurfaceElement = zoomSurfaceRef.current
          const nextTransformState = calculateImagePreviewCenteredZoomTransform({
            currentTransformState,
            nextScale,
            viewportHeight: zoomSurfaceElement?.clientHeight ?? 0,
            viewportWidth: zoomSurfaceElement?.clientWidth ?? 0,
          })

          setImageZoomPercentState(nextZoomPercent)
          setTransform(
            nextTransformState.positionX,
            nextTransformState.positionY,
            nextTransformState.scale,
            IMAGE_PREVIEW_ZOOM_ANIMATION_MS,
            'easeOut',
          )
        }

        return (
          <div className={cn('flex h-full min-h-0 flex-col bg-[var(--background-primary)]', className)}>
            {showToolbar ? (
              <PreviewToolbar
                fileName={fileName}
                leadingActions={leadingToolbarActions}
                trailingActions={(
                  <>
                    <ViewerZoomControls
                      ariaLabel='缩放比例'
                      onValueChange={setImageZoomPercent}
                      options={IMAGE_PREVIEW_ZOOM_OPTIONS}
                      value={imageZoomPercent}
                      zoomInLabel='放大'
                      zoomOutLabel='缩小'
                    />
                    <ViewerToolbarButton
                      type='button'
                      label='适应窗口'
                      onClick={() => resetTransform(IMAGE_PREVIEW_ZOOM_ANIMATION_MS, 'easeOut')}
                    >
                      <Fullscreen2Line aria-hidden='true' />
                    </ViewerToolbarButton>
                    {toolbarActions ? (
                      <>
                        <ViewerToolbarSeparator />
                        {toolbarActions}
                      </>
                    ) : null}
                  </>
                )}
              />
            ) : null}
            <div ref={zoomSurfaceRef} className='image-preview-zoom-surface'>
              <TransformComponent
                wrapperClass='image-preview-transform-wrapper'
                contentClass='image-preview-transform-content'
              >
                <img
                  alt={fileName}
                  className='image-preview-image'
                  draggable={false}
                  src={src}
                />
              </TransformComponent>
            </div>
          </div>
        )
      }}
    </TransformWrapper>
  )
}

export function WorkspaceFileRenderer({
  className,
  filePath,
  gitRepositoryState,
  iconTheme,
  leadingToolbarActions,
  meoSettings,
  showToolbar = true,
  theme,
  toolbarActions,
  workspacePath,
}: WorkspaceFileRendererProps) {
  const fileName = getBaseName(filePath)
  const toolbarLeadingActions = showToolbar ? leadingToolbarActions : undefined
  const toolbarTrailingActions = showToolbar ? toolbarActions : undefined
  const contentType = useMemo(() => inferFileContentType(filePath), [filePath])
  const file = useMemo(
    () => ({
      contentType,
      name: fileName,
      path: filePath,
    }),
    [contentType, fileName, filePath],
  )
  const [state, setState] = useState<PreviewState>({ status: 'loading' })
  const [isDarkPreview, setIsDarkPreview] = useState(false)

  useEffect(() => {
    let isCurrent = true

    if (!workspacePath) {
      setState({
        message: '请先选择工作区再渲染此文件。',
        status: 'error',
      })
      return () => {
        isCurrent = false
      }
    }

    setState({ status: 'loading' })

    void (async () => {
      try {
        const editorKind = await window.appApi.resolveWorkspaceEditorKind(filePath)
        if (!isCurrent) return

        const renderKind = resolveWorkspaceFileRenderKindForEditorKind(filePath, editorKind)

        if (renderKind === 'unsupported') {
          setState({ kind: renderKind, status: 'ready', url: null })
          return
        }

        if (renderKind === 'code' || renderKind === 'html' || renderKind === 'meo' || renderKind === 'csv') {
          const content = await window.appApi.readWorkspaceFile(filePath)
          if (!isCurrent) return

          setState({ content, kind: renderKind, status: 'ready', url: null })
          return
        }

        const resolvedContentType = getWorkspaceFileSystemContentType(file)

        const { url } = shouldUseWorkspaceFileDataUrl(file)
          ? await window.appApi.getWorkspaceFileDataUrl(workspacePath, filePath, resolvedContentType)
          : await window.appApi.getWorkspaceFileUrl(workspacePath, filePath)
        if (!isCurrent) return

        setState({ kind: renderKind, status: 'ready', url })
      } catch (error) {
        if (!isCurrent) return

        setState({
          message: error instanceof Error ? error.message : '无法加载此文件。',
          status: 'error',
        })
      }
    })()

    return () => {
      isCurrent = false
    }
  }, [contentType, file, filePath, workspacePath])

  if (state.status === 'loading') {
    return (
      <div className={cn('flex h-full min-h-0 flex-col bg-[var(--background-primary)]', className)}>
        {showToolbar ? (
          <PreviewToolbar
            fileName={fileName}
            leadingActions={toolbarLeadingActions}
            trailingActions={toolbarTrailingActions}
          />
        ) : null}
        <PreviewLoadingState />
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className={cn('flex h-full min-h-0 flex-col bg-[var(--background-primary)]', className)}>
        {showToolbar ? (
          <PreviewToolbar
            fileName={fileName}
            leadingActions={toolbarLeadingActions}
            trailingActions={toolbarTrailingActions}
          />
        ) : null}
        <PreviewUnavailableState fileName={fileName} iconTheme={iconTheme} message={state.message} />
      </div>
    )
  }

  if ((state.kind === 'code' || state.kind === 'html' || state.kind === 'meo') && state.content !== undefined) {
    return (
      <div className={cn('flex h-full min-h-0 flex-col bg-[var(--background-primary)]', className)}>
        {showToolbar ? (
          <PreviewToolbar
            fileName={fileName}
            leadingActions={toolbarLeadingActions}
            trailingActions={toolbarTrailingActions}
          />
        ) : null}
        {state.kind === 'html' ? (
          <HtmlPreview content={state.content} filePath={filePath} />
        ) : state.kind === 'meo' ? (
          <Suspense fallback={<PreviewLoadingState />}>
            <MeoEditorHost
              filePath={filePath}
              gitRepositoryState={gitRepositoryState}
              meoSettings={meoSettings}
              savedValue={state.content}
              theme={theme}
              value={state.content}
              workspacePath={workspacePath}
              onChange={() => undefined}
            />
          </Suspense>
        ) : (
          <Suspense fallback={<PreviewLoadingState />}>
            <CodeEditor
              disabled
              filePath={filePath}
              theme={theme}
              value={state.content}
              onChange={() => undefined}
            />
          </Suspense>
        )}
      </div>
    )
  }

  if (state.kind === 'csv' && state.content !== undefined) {
    return (
      <div className={cn('flex h-full min-h-0 flex-col bg-[var(--background-primary)]', className)}>
        <Suspense fallback={<PreviewLoadingState />}>
          <CsvViewer
            className='h-full min-h-0'
            data={state.content}
            leadingToolbarActions={toolbarLeadingActions}
            search={showToolbar}
            showDownload={false}
            showToolbar={showToolbar}
            showUpload={false}
            toolbarActions={toolbarTrailingActions}
          />
        </Suspense>
      </div>
    )
  }

  if (state.kind === 'unsupported' || !state.url) {
    return (
      <div className={cn('flex h-full min-h-0 flex-col bg-[var(--background-primary)]', className)}>
        {showToolbar ? (
          <PreviewToolbar
            fileName={fileName}
            leadingActions={toolbarLeadingActions}
            trailingActions={toolbarTrailingActions}
          />
        ) : null}
        <PreviewUnavailableState
          fileName={fileName}
          iconTheme={iconTheme}
          message='暂不支持渲染此文件类型。'
        />
      </div>
    )
  }

  if (state.kind === 'image' && state.url) {
    return (
      <ImagePreviewViewer
        className={className}
        fileName={fileName}
        leadingToolbarActions={toolbarLeadingActions}
        showToolbar={showToolbar}
        src={state.url}
        toolbarActions={toolbarTrailingActions}
      />
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-[var(--background-primary)]', className)}>
      <Suspense fallback={<PreviewLoadingState />}>
        {state.kind === 'pdf' ? (
          <PDFViewer
            className='h-full min-h-0'
            fileName={fileName}
            leadingToolbarActions={toolbarLeadingActions}
            showDownload={false}
            showToolbar={showToolbar}
            showUpload={false}
            src={state.url ?? undefined}
            toolbarActions={toolbarTrailingActions}
          />
        ) : null}
        {state.kind === 'docx' && state.url ? (
          <DocxViewerPreview
            className='h-full min-h-0'
            fileName={fileName}
            isDark={isDarkPreview}
            leadingToolbarActions={toolbarLeadingActions}
            onIsDarkChange={setIsDarkPreview}
            showDownload={false}
            showNightModeToggle={false}
            showToolbar={showToolbar}
            showUpload={false}
            src={state.url}
            toolbarActions={toolbarTrailingActions}
          />
        ) : null}
        {state.kind === 'xlsx' && state.url ? (
          <XlsxViewerPreview
            className='h-full min-h-0'
            fileName={fileName}
            isDark={isDarkPreview}
            leadingToolbarActions={toolbarLeadingActions}
            onIsDarkChange={setIsDarkPreview}
            showDownload={false}
            showNightModeToggle={false}
            showToolbar={showToolbar}
            showUpload={false}
            src={state.url}
            toolbarActions={toolbarTrailingActions}
          />
        ) : null}
        {state.kind === 'pptx' && state.url ? (
          <PptxViewerPreview
            className='h-full min-h-0'
            fileName={fileName}
            leadingToolbarActions={toolbarLeadingActions}
            showDownload={false}
            showToolbar={showToolbar}
            showUpload={false}
            src={state.url}
            toolbarActions={toolbarTrailingActions}
          />
        ) : null}
      </Suspense>
    </div>
  )
}

export function WorkspaceFilePreview(props: WorkspaceFilePreviewProps) {
  return <WorkspaceFileRenderer {...props} showToolbar />
}
