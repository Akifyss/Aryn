import type { Extension } from '@codemirror/state'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javaLanguage } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { phpLanguage } from '@codemirror/lang-php'
import { pythonLanguage } from '@codemirror/lang-python'
import { rustLanguage } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { getCodeLanguage } from '@/features/workspace/lib/file-types'

function hasExtension(filePath: string, extension: string) {
  return filePath.toLowerCase().endsWith(extension)
}

export function getCodeMirrorLanguageSupport(filePath: string): Extension {
  const language = getCodeLanguage(filePath)

  switch (language) {
    case 'markdown':
      return markdown()
    case 'html':
      return html()
    case 'javascript':
      return javascript({ jsx: hasExtension(filePath, '.jsx') })
    case 'typescript':
      return javascript({
        jsx: hasExtension(filePath, '.tsx'),
        typescript: true,
      })
    case 'json':
      return json()
    case 'css':
    case 'scss':
    case 'less':
      return css()
    case 'xml':
      return xml()
    case 'yaml':
      return yaml()
    case 'python':
      return pythonLanguage
    case 'java':
      return javaLanguage
    case 'rust':
      return rustLanguage
    case 'php':
      return phpLanguage
    case 'sql':
      return sql()
    default:
      return []
  }
}
