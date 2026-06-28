import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Fullscreen2Line, ZoomInLine, ZoomOutLine } from '@mingcute/react'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { AppTooltipButton } from '@/components/app-tooltip'
import { WorkspaceFileIcon } from '@/components/file-change-visuals'
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
  | { content?: string; kind: WorkspaceFileRenderKind; status: 'ready'; url: string | null }

const IMAGE_PREVIEW_WHEEL_STEP = 0.04
const IMAGE_PREVIEW_CONTROL_STEP = 0.1
const IMAGE_PREVIEW_DOUBLE_CLICK_STEP = 0.4
const IMAGE_PREVIEW_ZOOM_ANIMATION_MS = 140

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function getBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath
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
    <div className='viewer-toolbar'>
      {leadingActions ? <div className='viewer-toolbar-leading'>{leadingActions}</div> : null}
      <div className='viewer-toolbar-title'>{fileName}</div>
      {trailingActions ? <div className='viewer-toolbar-actions'>{trailingActions}</div> : null}
    </div>
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
      maxScale={8}
      minScale={0.1}
      panning={{ velocityDisabled: true }}
      smooth={false}
      wheel={{ step: IMAGE_PREVIEW_WHEEL_STEP }}
    >
      {({ resetTransform, zoomIn, zoomOut }) => (
        <div className={cn('flex h-full min-h-0 flex-col bg-[var(--background-primary)]', className)}>
          {showToolbar ? (
            <PreviewToolbar
              fileName={fileName}
              leadingActions={leadingToolbarActions}
              trailingActions={(
                <>
                  <AppTooltipButton
                    type='button'
                    aria-label='缩小'
                    className='viewer-toolbar-icon-button'
                    tooltip='缩小'
                    onClick={() => zoomOut(IMAGE_PREVIEW_CONTROL_STEP, IMAGE_PREVIEW_ZOOM_ANIMATION_MS, 'easeOut')}
                  >
                    <ZoomOutLine aria-hidden='true' />
                  </AppTooltipButton>
                  <AppTooltipButton
                    type='button'
                    aria-label='适应窗口'
                    className='viewer-toolbar-icon-button'
                    tooltip='适应窗口'
                    onClick={() => resetTransform(IMAGE_PREVIEW_ZOOM_ANIMATION_MS, 'easeOut')}
                  >
                    <Fullscreen2Line aria-hidden='true' />
                  </AppTooltipButton>
                  <AppTooltipButton
                    type='button'
                    aria-label='放大'
                    className='viewer-toolbar-icon-button'
                    tooltip='放大'
                    onClick={() => zoomIn(IMAGE_PREVIEW_CONTROL_STEP, IMAGE_PREVIEW_ZOOM_ANIMATION_MS, 'easeOut')}
                  >
                    <ZoomInLine aria-hidden='true' />
                  </AppTooltipButton>
                  {toolbarActions}
                </>
              )}
            />
          ) : null}
          <div className='image-preview-zoom-surface'>
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
      )}
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

        if (renderKind === 'code' || renderKind === 'html' || renderKind === 'meo') {
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

  if (state.kind === 'image') {
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
            showToolbar={showToolbar}
            showUpload={false}
            src={state.url}
            toolbarActions={toolbarTrailingActions}
          />
        ) : null}
        {state.kind === 'docx' ? (
          <DocxViewerPreview
            className='h-full min-h-0'
            fileName={fileName}
            isDark={isDarkPreview}
            leadingToolbarActions={toolbarLeadingActions}
            onIsDarkChange={setIsDarkPreview}
            showToolbar={showToolbar}
            showUpload={false}
            src={state.url}
            toolbarActions={toolbarTrailingActions}
          />
        ) : null}
        {state.kind === 'xlsx' ? (
          <XlsxViewerPreview
            className='h-full min-h-0'
            fileName={fileName}
            isDark={isDarkPreview}
            leadingToolbarActions={toolbarLeadingActions}
            onIsDarkChange={setIsDarkPreview}
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
