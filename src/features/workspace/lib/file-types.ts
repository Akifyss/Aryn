export type WorkspaceEditorKind = 'rich-text' | 'code' | 'unsupported'
export type SupportedWorkspaceEditorKind = Exclude<WorkspaceEditorKind, 'unsupported'>

const RICH_TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdx',
  '.txt',
  '.text',
])

const RICH_TEXT_FILE_NAMES = new Set([
  'readme',
  'changelog',
  'license',
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

  if (RICH_TEXT_FILE_NAMES.has(baseName) || RICH_TEXT_EXTENSIONS.has(extension)) {
    return 'rich-text'
  }

  if (CODE_FILE_NAMES.has(baseName) || CODE_EXTENSIONS.has(extension)) {
    return 'code'
  }

  return 'unsupported'
}

export function getSupportedWorkspaceEditorKind(filePath: string): SupportedWorkspaceEditorKind | null {
  const editorKind = getWorkspaceEditorKind(filePath)
  return editorKind === 'unsupported' ? null : editorKind
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
