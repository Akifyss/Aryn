import { inferFileContentType } from '@/lib/file-content-types'
import {
  getDefaultWorkspaceFileViewMode,
  getWorkspaceEditorKind,
  type WorkspaceFileTabEditorKind,
} from '@/features/workspace/lib/file-types'
import {
  isWorkspaceFileSystemCsv,
  isWorkspaceFileSystemDocx,
  isWorkspaceFileSystemImage,
  isWorkspaceFileSystemPdf,
  isWorkspaceFileSystemSpreadsheet,
} from '@/features/workspace/lib/workspace-file-system'

export type WorkspaceFileRenderKind = 'code' | 'csv' | 'docx' | 'html' | 'image' | 'meo' | 'pdf' | 'unsupported' | 'xlsx'

function getBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function resolveBinaryFileRenderKind(filePath: string): WorkspaceFileRenderKind {
  const fileName = getBaseName(filePath)
  const normalizedFileName = fileName.toLowerCase()

  if (/\.(csv|tsv)$/.test(normalizedFileName)) return 'csv'

  const file = {
    contentType: inferFileContentType(filePath),
    name: fileName,
    path: filePath,
  }

  if (isWorkspaceFileSystemImage(file)) return 'image'
  if (isWorkspaceFileSystemPdf(file)) return 'pdf'
  if (isWorkspaceFileSystemDocx(file)) return 'docx'
  if (isWorkspaceFileSystemCsv(file)) return 'csv'
  if (isWorkspaceFileSystemSpreadsheet(file)) return 'xlsx'

  return 'unsupported'
}

function getFileRenderSourceKind(filePath: string): WorkspaceFileTabEditorKind | null {
  const editorKind = getWorkspaceEditorKind(filePath)

  if (editorKind === 'prose' || editorKind === 'code' || editorKind === 'file') {
    return editorKind
  }

  return null
}

export function resolveWorkspaceFileRenderKindForEditorKind(
  filePath: string,
  sourceKind: WorkspaceFileTabEditorKind | null,
): WorkspaceFileRenderKind {
  if (!sourceKind) {
    return 'unsupported'
  }

  const viewMode = getDefaultWorkspaceFileViewMode(filePath, sourceKind)

  if (viewMode === 'meo') {
    return 'meo'
  }

  if (viewMode === 'preview') {
    return 'html'
  }

  if (viewMode === 'code') {
    return 'code'
  }

  return resolveBinaryFileRenderKind(filePath)
}

export function resolveWorkspaceFileRenderKind(filePath: string): WorkspaceFileRenderKind {
  return resolveWorkspaceFileRenderKindForEditorKind(filePath, getFileRenderSourceKind(filePath))
}
