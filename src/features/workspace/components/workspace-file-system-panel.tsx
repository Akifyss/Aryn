import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderForbidLine, FolderOpenLine } from '@mingcute/react'
import {
  FileSystem,
  type FileSystemFileItem,
  type FileSystemLoadChildrenResult,
} from '@/components/ui/file-system'
import {
  getWorkspaceFileSystemContentType,
  isWorkspaceFileSystemCsv,
  isWorkspaceFileSystemDocx,
  isWorkspaceFileSystemImage,
  isWorkspaceFileSystemPdf,
  isWorkspaceFileSystemSpreadsheet,
  shouldUseWorkspaceFileDataUrl,
  workspaceNodesToFileSystemItems,
} from '@/features/workspace/lib/workspace-file-system'
import { WorkspaceFileRenderer } from '@/features/workspace/components/workspace-file-preview'
import type { GitRepositoryState } from '@/features/git/types'
import type { AppTheme, MeoSettings } from '@/hooks/use-settings-store'
import type {
  WorkspaceFileSystemNavigationState,
  WorkspaceFileSystemState,
  WorkspaceFileSystemView,
  WorkspaceIconTheme,
  WorkspaceNode,
} from '@/features/workspace/types'

type WorkspaceFileSystemPanelProps = {
  fileSystemState: WorkspaceFileSystemState
  gitRepositoryState: GitRepositoryState | null
  iconTheme: WorkspaceIconTheme | null
  meoSettings: MeoSettings
  nodes: WorkspaceNode[]
  theme: AppTheme
  title: string
  workspacePath: string | null
  workspaceUnavailableMessage?: string | null
  onOpenFile: (filePath: string) => void
  onFileSystemNavigationChange: (navigation: WorkspaceFileSystemNavigationState) => void
  onFileSystemSelectionChange: (selectedPath: string | null) => void
  onFileSystemViewChange: (view: WorkspaceFileSystemView) => void
}

function resolveFilePath(file: FileSystemFileItem) {
  return file.key ?? file.path
}

function getPreviewSourceCacheKey(file: FileSystemFileItem) {
  return [resolveFilePath(file), file.updatedAt ?? '', file.size ?? ''].join(':')
}

function loadImagePreviewMetadata(url: string) {
  return new Promise<{ previewAspectRatio: number | null; url: string }>((resolve) => {
    const image = new Image()

    const finish = (previewAspectRatio: number | null) => {
      image.onload = null
      image.onerror = null
      resolve({ previewAspectRatio, url })
    }

    image.decoding = 'async'
    image.onload = () => {
      const ratio = image.naturalWidth > 0 && image.naturalHeight > 0
        ? image.naturalWidth / image.naturalHeight
        : null

      finish(ratio && Number.isFinite(ratio) ? ratio : null)
    }
    image.onerror = () => finish(null)
    image.src = url
  })
}

function WorkspaceImagePreview({
  file,
  workspacePath,
}: {
  file: FileSystemFileItem
  workspacePath: string
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(file.url ?? null)

  useEffect(() => {
    let isCurrent = true

    setPreviewUrl(file.url ?? null)

    if (file.url) {
      return
    }

    void window.appApi.getWorkspaceFileDataUrl(
      workspacePath,
      resolveFilePath(file),
      getWorkspaceFileSystemContentType(file),
    )
      .then(({ url }) => {
        if (isCurrent) {
          setPreviewUrl(url)
        }
      })
      .catch(() => {
        if (isCurrent) {
          setPreviewUrl(null)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [file, workspacePath])

  if (!previewUrl) {
    return null
  }

  return (
    <img
      alt=''
      className='size-full object-cover'
      draggable={false}
      src={previewUrl}
    />
  )
}

function getDefaultFolderPath(selectedPath: string | null) {
  if (!selectedPath) {
    return ''
  }

  const normalizedPath = selectedPath.replace(/\/+$/, '')
  const lastSlashIndex = normalizedPath.lastIndexOf('/')

  return lastSlashIndex === -1 ? '' : `${normalizedPath.slice(0, lastSlashIndex)}/`
}

function getDefaultNavigationState(selectedPath: string | null): WorkspaceFileSystemNavigationState | null {
  const folderPath = getDefaultFolderPath(selectedPath)

  if (!folderPath) {
    return null
  }

  const stack = ['']
  const segments = folderPath.replace(/\/+$/, '').split('/').filter(Boolean)
  let currentPath = ''

  for (const segment of segments) {
    currentPath = `${currentPath}${segment}/`
    stack.push(currentPath)
  }

  return {
    index: stack.length - 1,
    stack,
  }
}

export function WorkspaceFileSystemPanel({
  fileSystemState,
  gitRepositoryState,
  iconTheme,
  meoSettings,
  nodes,
  theme,
  title,
  workspacePath,
  workspaceUnavailableMessage,
  onOpenFile,
  onFileSystemNavigationChange,
  onFileSystemSelectionChange,
  onFileSystemViewChange,
}: WorkspaceFileSystemPanelProps) {
  const items = useMemo(
    () => workspacePath
      ? workspaceNodesToFileSystemItems(nodes, workspacePath, { includeDescendants: false })
      : [],
    [nodes, workspacePath],
  )
  const defaultPath = useMemo(
    () => getDefaultFolderPath(fileSystemState.selectedPath),
    [fileSystemState.selectedPath],
  )
  const navigationState = useMemo(
    () => fileSystemState.navigation ?? getDefaultNavigationState(fileSystemState.selectedPath),
    [fileSystemState.navigation, fileSystemState.selectedPath],
  )
  const previewSourceCache = useMemo(() => new Map<string, Promise<string>>(), [workspacePath])
  const getPreviewSourceUrl = useCallback(
    (file: FileSystemFileItem, fallbackContentType: string) => {
      if (!workspacePath) {
        return Promise.resolve('')
      }

      const cacheKey = getPreviewSourceCacheKey(file)
      const cachedSource = previewSourceCache.get(cacheKey)

      if (cachedSource) {
        return cachedSource
      }

      const sourcePromise = window.appApi.getWorkspaceFileDataUrl(
        workspacePath,
        resolveFilePath(file),
        getWorkspaceFileSystemContentType(file, fallbackContentType),
      ).then(({ url }) => url)

      previewSourceCache.set(cacheKey, sourcePromise)
      if (previewSourceCache.size > 8) {
        const oldestKey = previewSourceCache.keys().next().value

        if (oldestKey) {
          previewSourceCache.delete(oldestKey)
        }
      }
      void sourcePromise.catch(() => {
        if (previewSourceCache.get(cacheKey) === sourcePromise) {
          previewSourceCache.delete(cacheKey)
        }
      })

      return sourcePromise
    },
    [previewSourceCache, workspacePath],
  )
  const getFileUrl = useCallback(
    async (file: FileSystemFileItem) => {
      if (!workspacePath) {
        return ''
      }

      const filePath = resolveFilePath(file)
      const { url } = shouldUseWorkspaceFileDataUrl(file)
        ? await window.appApi.getWorkspaceFileDataUrl(
            workspacePath,
            filePath,
            getWorkspaceFileSystemContentType(file),
          )
        : await window.appApi.getWorkspaceFileUrl(workspacePath, filePath)

      return url
    },
    [workspacePath],
  )
  const loadPreviewImageUrl = useCallback(
    async (file: FileSystemFileItem, pageIndex: number) => {
      if (!workspacePath || pageIndex < 0) {
        return null
      }

      if (isWorkspaceFileSystemImage(file)) {
        if (pageIndex !== 0) {
          return null
        }

        const { url } = await window.appApi.getWorkspaceFileDataUrl(
          workspacePath,
          resolveFilePath(file),
          getWorkspaceFileSystemContentType(file),
        )
        const imagePreview = await loadImagePreviewMetadata(url)

        return {
          pageCount: 1,
          ...imagePreview,
        }
      }

      if (isWorkspaceFileSystemPdf(file)) {
        const url = await getPreviewSourceUrl(file, 'application/pdf')
        const { loadPdfDocument, renderPdfThumbnailUrl } = await import('@/components/pdf-thumbnail-utils')
        const document = await loadPdfDocument(url)
        const page = document.pages[pageIndex]
        const thumbnailUrl = page
          ? await renderPdfThumbnailUrl({
              dpr: 1,
              pageIndex,
              url,
              width: 320,
            })
          : null

        return {
          pageCount: document.pageCount,
          previewAspectRatio: page ? page.size.width / page.size.height : null,
          url: thumbnailUrl,
        }
      }

      if (isWorkspaceFileSystemDocx(file)) {
        const url = await getPreviewSourceUrl(
          file,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )
        const { renderDocxPageToDataUrlWithPageCount } = await import('@/components/docx-thumbnail-utils')

        return renderDocxPageToDataUrlWithPageCount(url, {
          maxWidth: 320,
          pageNumber: pageIndex + 1,
        })
      }

      if (isWorkspaceFileSystemSpreadsheet(file)) {
        const url = await getPreviewSourceUrl(
          file,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        const { renderXlsxSheetToDataUrlWithSheetCount } = await import('@/components/ui/xlsx-viewer')

        return renderXlsxSheetToDataUrlWithSheetCount(url, {
          cacheKey: `${workspacePath}:${getPreviewSourceCacheKey(file)}`,
          maxHeight: 260,
          maxWidth: 360,
          pixelRatio: 1,
          sheetIndex: pageIndex,
        })
      }

      if (isWorkspaceFileSystemCsv(file)) {
        const content = await window.appApi.readWorkspaceFile(resolveFilePath(file))
        const { renderCsvToDataUrlWithRowCount } = await import('@/components/ui/csv-viewer')

        return renderCsvToDataUrlWithRowCount(content, {
          maxHeight: 260,
          maxWidth: 360,
          pixelRatio: 1,
        })
      }

      return null
    },
    [getPreviewSourceUrl, workspacePath],
  )
  const loadChildren = useCallback(
    async ({ cursor, path }: { cursor: string | null; path: string }): Promise<FileSystemLoadChildrenResult> => {
      if (!workspacePath || cursor) {
        return { items: [], nextCursor: null }
      }

      const childNodes = await window.appApi.loadWorkspaceDirectory(workspacePath, path)

      return {
        items: workspaceNodesToFileSystemItems(childNodes, workspacePath, { includeDescendants: false }),
        nextCursor: null,
      }
    },
    [workspacePath],
  )

  if (workspaceUnavailableMessage) {
    return (
      <div className='workspace-file-system-unavailable'>
        <div className='workspace-file-system-unavailable-icon'>
          <FolderForbidLine size={28} />
        </div>
        <p>{workspaceUnavailableMessage}</p>
      </div>
    )
  }

  if (!workspacePath) {
    return (
      <div className='workspace-file-system-unavailable'>
        <div className='workspace-file-system-unavailable-icon'>
          <FolderOpenLine size={28} />
        </div>
        <p>选择一个工作区以浏览文件。</p>
      </div>
    )
  }

  return (
    <FileSystem
      key={workspacePath}
      className='workspace-file-system'
      defaultPath={defaultPath}
      defaultView='icons'
      getFileUrl={getFileUrl}
      items={items}
      loadChildren={loadChildren}
      loadPreviewImageUrl={loadPreviewImageUrl}
      navigationState={navigationState}
      renderFilePreview={(file) => (
        isWorkspaceFileSystemImage(file) && workspacePath
          ? <WorkspaceImagePreview file={file} workspacePath={workspacePath} />
          : null
      )}
      renderFileStage={(file, context) => (
        <WorkspaceFileRenderer
          className='size-full'
          filePath={resolveFilePath(file)}
          gitRepositoryState={gitRepositoryState}
          iconTheme={iconTheme}
          meoSettings={meoSettings}
          showToolbar
          theme={theme}
          toolbarActions={context.toolbarActions}
          workspacePath={workspacePath}
        />
      )}
      selectedPath={fileSystemState.selectedPath}
      title={title}
      view={fileSystemState.view}
      onFileOpen={(file) => {
        onOpenFile(resolveFilePath(file))
        return true
      }}
      onSelectionChange={(item) => {
        onFileSystemSelectionChange(item?.path ?? null)
      }}
      onNavigationStateChange={onFileSystemNavigationChange}
      onViewChange={(view) => {
        onFileSystemViewChange(view)
      }}
    />
  )
}
