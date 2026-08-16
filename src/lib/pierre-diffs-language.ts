const HIGHLIGHTED_LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.c': 'c',
  '.cc': 'cpp',
  '.cjs': 'javascript',
  '.conf': 'ini',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.cts': 'typescript',
  '.cxx': 'cpp',
  '.css': 'css',
  '.go': 'go',
  '.h': 'c',
  '.hpp': 'cpp',
  '.htm': 'html',
  '.html': 'html',
  '.ini': 'ini',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.jsx': 'jsx',
  '.markdown': 'markdown',
  '.md': 'markdown',
  '.mdc': 'markdown',
  '.mdx': 'markdown',
  '.mjs': 'javascript',
  '.mts': 'typescript',
  '.php': 'php',
  '.proto': 'proto',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.scss': 'scss',
  '.sh': 'shellscript',
  '.sql': 'sql',
  '.svg': 'xml',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.vue': 'vue',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'shellscript',
}

function getBaseName(fileName: string) {
  return fileName.split(/[\\/]/).pop()?.toLowerCase() ?? fileName.toLowerCase()
}

export function getPierreDiffLanguage(fileName: string) {
  const baseName = getBaseName(fileName)
  if (baseName === 'dockerfile' || baseName.endsWith('.dockerfile')) return 'docker'

  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex <= 0) return 'text'

  return HIGHLIGHTED_LANGUAGE_BY_EXTENSION[baseName.slice(dotIndex)] ?? 'text'
}
