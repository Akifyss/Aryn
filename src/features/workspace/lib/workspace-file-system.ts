import type { FileSystemFileItem, FileSystemItem } from '@/components/ui/file-system'
import { inferFileContentType } from '@/lib/file-content-types'
import { isPptxContentType, isPptxFile } from '@/lib/pptx-file-types'
import { getRelativePath } from '@/features/workspace/lib/workspace-paths'
import type { WorkspaceNode } from '@/features/workspace/types'

const CODE_CONTENT_TYPES = new Set([
  'application/json',
  'application/sql',
  'application/toml',
  'application/x-httpd-php',
  'application/x-sh',
  'application/xml',
  'text/css',
  'text/html',
  'text/javascript',
  'text/jsx',
  'text/x-c',
  'text/x-c++src',
  'text/x-dart',
  'text/x-go',
  'text/x-java-source',
  'text/x-kotlin',
  'text/x-lua',
  'text/x-python',
  'text/x-rust',
  'text/x-scss',
  'text/x-svelte',
  'text/x-swift',
  'text/x-typescript',
  'text/x-vue',
  'text/yaml',
])

const PREVIEWABLE_IMAGE_CONTENT_TYPES = new Set([
  'image/apng',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'image/x-icon',
])

function normalizePathForManifest(filePath: string) {
  return filePath.replace(/[\\/]+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

function getRelativeWorkspacePath(rootPath: string, filePath: string) {
  return normalizePathForManifest(getRelativePath(rootPath, filePath))
}

function getFileExtension(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()

  return extension && extension !== fileName.toLowerCase() ? extension : null
}

function getWorkspaceFileKind(fileName: string, contentType: string | undefined) {
  const extension = getFileExtension(fileName)

  if (contentType === 'application/pdf') return 'PDF 文档'
  if (
    contentType === 'application/msword'
    || contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) return 'Word 文档'
  if (
    contentType === 'application/vnd.ms-excel'
    || contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || contentType === 'application/vnd.oasis.opendocument.spreadsheet'
  ) {
    return '表格'
  }
  if (contentType === 'text/csv' || contentType === 'text/tab-separated-values') {
    return '表格'
  }
  if (
    contentType === 'application/vnd.ms-powerpoint'
    || isPptxContentType(contentType)
    || contentType === 'application/vnd.oasis.opendocument.presentation'
  ) return '演示文稿'
  if (contentType === 'application/epub+zip') return 'EPUB 文档'
  if (contentType === 'application/rtf' || contentType === 'application/vnd.oasis.opendocument.text') {
    return '文本文档'
  }
  if (contentType?.startsWith('image/')) return '图片'
  if (contentType?.startsWith('audio/')) return '音频'
  if (contentType?.startsWith('video/')) return '视频'
  if (contentType?.startsWith('font/')) return '字体'
  if (contentType === 'text/markdown' || contentType === 'text/mdx') return 'Markdown 文档'
  if (contentType && CODE_CONTENT_TYPES.has(contentType)) {
    return extension ? `${extension.toUpperCase()} 文件` : '代码文件'
  }
  if (contentType?.startsWith('text/')) return '文本文档'
  if (extension) return `${extension.toUpperCase()} 文件`

  return '文件'
}

function getWorkspaceNodeMetadata(node: WorkspaceNode) {
  return {
    ...(typeof node.size === 'number' ? { size: node.size } : null),
    ...(node.createdAt ? { createdAt: node.createdAt } : null),
    ...(node.updatedAt ? { updatedAt: node.updatedAt } : null),
  }
}

function getWorkspaceFileSystemMetadata(fileName: string, contentType: string | undefined) {
  const extension = getFileExtension(fileName)
  const metadata: Record<string, string> = {
    Kind: getWorkspaceFileKind(fileName, contentType),
  }

  if (extension) {
    metadata.Extension = extension.toUpperCase()
  }

  return metadata
}

export function isWorkspaceFileSystemPreviewable(file: Pick<FileSystemFileItem, 'contentType' | 'name' | 'path'>) {
  if (isWorkspaceFileSystemImage(file)) {
    return true
  }

  if (file.contentType === 'application/pdf') {
    return true
  }

  if (isWorkspaceFileSystemPptx(file)) {
    return true
  }

  const name = (file.name ?? file.path).toLowerCase()

  return /\.(avif|gif|jpe?g|png|svg|webp|pdf|docx|xlsx?|xls|csv|tsv)$/.test(name)
}

export function isWorkspaceFileSystemDocx(file: Pick<FileSystemFileItem, 'contentType' | 'name' | 'path'>) {
  if (file.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return true
  }

  return /\.docx$/.test((file.name ?? file.path).toLowerCase())
}

export function isWorkspaceFileSystemPptx(file: Pick<FileSystemFileItem, 'contentType' | 'name' | 'path'>) {
  return isPptxFile(file)
}

export function isWorkspaceFileSystemSpreadsheet(file: Pick<FileSystemFileItem, 'contentType' | 'name' | 'path'>) {
  if (
    file.contentType === 'application/vnd.ms-excel'
    || file.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return true
  }

  return /\.(xlsx?|xls)$/.test((file.name ?? file.path).toLowerCase())
}

export function isWorkspaceFileSystemCsv(file: Pick<FileSystemFileItem, 'contentType' | 'name' | 'path'>) {
  if (file.contentType === 'text/csv' || file.contentType === 'text/tab-separated-values') {
    return true
  }

  return /\.(csv|tsv)$/.test((file.name ?? file.path).toLowerCase())
}

export function isWorkspaceFileSystemImage(file: Pick<FileSystemFileItem, 'contentType' | 'name' | 'path'>) {
  if (file.contentType) {
    return PREVIEWABLE_IMAGE_CONTENT_TYPES.has(file.contentType)
  }

  return /\.(apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)$/.test((file.name ?? file.path).toLowerCase())
}

export function isWorkspaceFileSystemPdf(file: Pick<FileSystemFileItem, 'contentType' | 'name' | 'path'>) {
  if (file.contentType === 'application/pdf') {
    return true
  }

  return /\.pdf$/.test((file.name ?? file.path).toLowerCase())
}

export function getWorkspaceFileSystemContentType(
  file: Pick<FileSystemFileItem, 'contentType' | 'name' | 'path'>,
  fallbackContentType = 'application/octet-stream',
) {
  return file.contentType
    ?? inferFileContentType(file.name ?? file.path)
    ?? fallbackContentType
}

function getWorkspacePreviewMetadata(file: Pick<FileSystemFileItem, 'contentType' | 'name' | 'path'>) {
  if (
    !isWorkspaceFileSystemImage(file)
    && !isWorkspaceFileSystemPdf(file)
    && !isWorkspaceFileSystemDocx(file)
    && !isWorkspaceFileSystemPptx(file)
    && !isWorkspaceFileSystemCsv(file)
    && !isWorkspaceFileSystemSpreadsheet(file)
  ) {
    return null
  }

  return {
    ...(isWorkspaceFileSystemSpreadsheet(file) || isWorkspaceFileSystemCsv(file) ? { previewAspectRatio: 1.35 } : null),
    ...(isWorkspaceFileSystemPptx(file) ? { previewAspectRatio: 16 / 9 } : null),
    previewPageCount: 1,
  }
}

export function shouldUseWorkspaceFileDataUrl(file: Pick<FileSystemFileItem, 'contentType' | 'name' | 'path'>) {
  const contentType = getWorkspaceFileSystemContentType(file, '')
  const name = (file.name ?? file.path).toLowerCase()

  return isWorkspaceFileSystemImage(file)
    || contentType === 'application/pdf'
    || contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || contentType === 'application/vnd.ms-excel'
    || isPptxFile(file)
    || contentType === 'text/csv'
    || contentType === 'text/tab-separated-values'
    || /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp|pdf|docx|xlsx?|xls|csv|tsv)$/.test(name)
}

type WorkspaceFileSystemItemsOptions = {
  includeDescendants?: boolean
}

export function workspaceNodesToFileSystemItems(
  nodes: WorkspaceNode[],
  rootPath: string,
  options: WorkspaceFileSystemItemsOptions = {},
): FileSystemItem[] {
  const items: FileSystemItem[] = []
  const includeDescendants = options.includeDescendants ?? true

  const walk = (nodeList: WorkspaceNode[]) => {
    for (const node of nodeList) {
      const relativePath = getRelativeWorkspacePath(rootPath, node.path)
      if (!relativePath) {
        continue
      }

      if (node.kind === 'directory') {
        items.push({
          kind: 'folder',
          ...getWorkspaceNodeMetadata(node),
          name: node.name,
          path: `${relativePath}/`,
          hasChildren: Boolean(node.hasChildren || node.children?.length),
        })

        if (includeDescendants && node.children?.length) {
          walk(node.children)
        }
        continue
      }

      const contentType = inferFileContentType(node.name)

      items.push({
        kind: 'file',
        ...getWorkspaceNodeMetadata(node),
        contentType,
        key: node.path,
        metadata: getWorkspaceFileSystemMetadata(node.name, contentType),
        name: node.name,
        path: relativePath,
        ...getWorkspacePreviewMetadata({
          contentType,
          name: node.name,
          path: relativePath,
        }),
      })
    }
  }

  walk(nodes)
  return items
}
