export type WorkspaceEditorKind = 'prose' | 'code' | 'file' | 'unsupported'
export type SupportedWorkspaceEditorKind = 'prose' | 'code'
export type WorkspaceFileTabEditorKind = SupportedWorkspaceEditorKind | 'file'
export type WorkspaceFileViewMode = 'code' | 'file' | 'meo' | 'preview'
export type LegacyWorkspaceFileViewMode = WorkspaceFileViewMode | 'default'

const PROSE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdc',
  '.mdx',
  '.txt',
  '.text',
])

const PROSE_FILE_NAMES = new Set([
  'readme',
  'changelog',
  'license',
])

const MEO_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdc',
  '.mdx',
])

const CODE_EXTENSIONS = new Set([
  '.astro',
  '.bat',
  '.c',
  '.cc',
  '.cmd',
  '.conf',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.cts',
  '.cxx',
  '.dart',
  '.dockerfile',
  '.env',
  '.erb',
  '.go',
  '.gql',
  '.graphql',
  '.h',
  '.hpp',
  '.htm',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.kt',
  '.kts',
  '.less',
  '.log',
  '.lua',
  '.mjs',
  '.mts',
  '.php',
  '.pl',
  '.properties',
  '.ps1',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.svg',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh',
])

const CODE_FILE_NAMES = new Set([
  '.editorconfig',
  '.env',
  '.env.development',
  '.env.example',
  '.env.local',
  '.env.production',
  '.env.test',
  '.gitattributes',
  '.gitignore',
  '.gitmodules',
  '.npmrc',
  '.nvmrc',
  '.prettierignore',
  '.prettierrc',
  'dockerfile',
  'makefile',
])

const FILE_TAB_EXTENSIONS = new Set([
  '.7z',
  '.apng',
  '.avif',
  '.bmp',
  '.bz2',
  '.doc',
  '.docx',
  '.dmg',
  '.epub',
  '.gif',
  '.gz',
  '.heic',
  '.heif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.odp',
  '.ods',
  '.odt',
  '.pdf',
  '.png',
  '.ppt',
  '.pptx',
  '.rar',
  '.rtf',
  '.svg',
  '.tar',
  '.tif',
  '.tiff',
  '.webp',
  '.xls',
  '.xlsx',
  '.zip',
])

function getBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop()?.toLowerCase() ?? filePath.toLowerCase()
}

function getFileExtension(filePath: string) {
  const baseName = getBaseName(filePath)
  const dotIndex = baseName.lastIndexOf('.')

  if (dotIndex <= 0) {
    return ''
  }

  return baseName.slice(dotIndex)
}

export function getWorkspaceEditorKind(filePath: string): WorkspaceEditorKind {
  const baseName = getBaseName(filePath)
  const extension = getFileExtension(filePath)

  if (PROSE_FILE_NAMES.has(baseName) || PROSE_EXTENSIONS.has(extension)) {
    return 'prose'
  }

  if (CODE_FILE_NAMES.has(baseName) || CODE_EXTENSIONS.has(extension)) {
    return 'code'
  }

  if (FILE_TAB_EXTENSIONS.has(extension)) {
    return 'file'
  }

  return 'unsupported'
}

export function getSupportedWorkspaceEditorKind(filePath: string): SupportedWorkspaceEditorKind | null {
  const editorKind = getWorkspaceEditorKind(filePath)
  return editorKind === 'prose' || editorKind === 'code' ? editorKind : null
}

export function getWorkspaceFileTabEditorKind(filePath: string): WorkspaceFileTabEditorKind | null {
  const editorKind = getWorkspaceEditorKind(filePath)

  if (editorKind === 'prose' || editorKind === 'code' || editorKind === 'file') {
    return editorKind
  }

  return null
}

export function supportsHtmlPreview(filePath: string) {
  const extension = getFileExtension(filePath)

  return extension === '.html' || extension === '.htm'
}

export function supportsAlternateCodeEditorView(
  filePath: string,
  editorKind: SupportedWorkspaceEditorKind,
) {
  return supportsMeoEditor(filePath, editorKind) || (editorKind === 'code' && supportsHtmlPreview(filePath))
}

export function supportsMeoEditor(filePath: string, editorKind: SupportedWorkspaceEditorKind) {
  return editorKind === 'prose' && MEO_EXTENSIONS.has(getFileExtension(filePath))
}

export function getDefaultWorkspaceFileViewMode(
  filePath: string,
  editorKind: WorkspaceFileTabEditorKind,
): WorkspaceFileViewMode {
  if (editorKind === 'file') {
    return 'file'
  }

  if (supportsMeoEditor(filePath, editorKind)) {
    return 'meo'
  }

  if (editorKind === 'code' && supportsHtmlPreview(filePath)) {
    return 'preview'
  }

  return 'code'
}

export function normalizeWorkspaceFileViewMode(
  filePath: string,
  editorKind: WorkspaceFileTabEditorKind,
  viewMode?: LegacyWorkspaceFileViewMode,
): WorkspaceFileViewMode {
  if (editorKind === 'file') {
    return 'file'
  }

  if (viewMode === 'meo' && supportsMeoEditor(filePath, editorKind)) {
    return viewMode
  }

  if (viewMode === 'code') {
    return viewMode
  }

  if (viewMode === 'preview' && editorKind === 'code' && supportsHtmlPreview(filePath)) {
    return viewMode
  }

  return getDefaultWorkspaceFileViewMode(filePath, editorKind)
}

export function getCodeLanguage(filePath: string) {
  const baseName = getBaseName(filePath)
  const extension = getFileExtension(filePath)

  if (baseName === 'dockerfile') {
    return 'dockerfile'
  }

  switch (extension) {
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript'
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return 'typescript'
    case '.json':
    case '.jsonc':
      return 'json'
    case '.css':
      return 'css'
    case '.scss':
      return 'scss'
    case '.less':
      return 'less'
    case '.html':
    case '.htm':
    case '.vue':
    case '.svelte':
      return 'html'
    case '.xml':
    case '.svg':
      return 'xml'
    case '.yaml':
    case '.yml':
      return 'yaml'
    case '.md':
    case '.mdc':
    case '.markdown':
    case '.mdx':
      return 'markdown'
    case '.sh':
    case '.zsh':
      return 'shell'
    case '.ps1':
      return 'powershell'
    case '.py':
      return 'python'
    case '.rb':
    case '.erb':
      return 'ruby'
    case '.rs':
      return 'rust'
    case '.go':
      return 'go'
    case '.java':
      return 'java'
    case '.kt':
    case '.kts':
      return 'kotlin'
    case '.php':
      return 'php'
    case '.sql':
      return 'sql'
    case '.graphql':
    case '.gql':
      return 'graphql'
    case '.c':
    case '.h':
      return 'c'
    case '.cc':
    case '.cpp':
    case '.cxx':
    case '.hpp':
      return 'cpp'
    case '.ini':
    case '.conf':
    case '.properties':
    case '.toml':
      return 'ini'
    default:
      return 'plaintext'
  }
}
