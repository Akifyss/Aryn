import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cssPath = path.join(root, 'packages', 'codex-session-surface', 'dist', 'style.css')
const css = await readFile(cssPath, 'utf8')
const surface = '.aryn-codex-session-surface'
const violations = []

if (/prefers-color-scheme\s*:\s*dark/i.test(css)) {
  violations.push('system dark-mode media query (Aryn uses its explicit .dark theme scope)')
}

const cssRoot = postcss.parse(css)

cssRoot.walkRules((rule) => {
  if (rule.parent?.type === 'atrule' && rule.parent.name.toLowerCase().endsWith('keyframes')) return
  for (const selector of rule.selectors) {
    if (!selector.includes(surface)) violations.push(selector)
  }
})

cssRoot.walkAtRules((rule) => {
  if (rule.name.toLowerCase() === 'property') {
    violations.push(`@${rule.name} ${rule.params}`)
    return
  }
  if (rule.name.toLowerCase().endsWith('keyframes') && !rule.params.startsWith('aryn-codex-')) {
    violations.push(`@${rule.name} ${rule.params}`)
  }
})

if (violations.length > 0) {
  throw new Error(`Codex surface CSS escaped its host: ${violations.slice(0, 8).join(', ')}`)
}
