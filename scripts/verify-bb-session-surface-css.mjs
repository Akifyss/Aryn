import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDirectory, '..')
const cssPath = path.join(root, 'packages', 'bb-session-surface', 'dist', 'style.css')

if (!fs.existsSync(cssPath)) {
  throw new Error(`Missing built stylesheet: ${cssPath}`)
}

const css = fs.readFileSync(cssPath, 'utf8')
const allowedStarts = [
  '.aryn-bb-session-surface',
  '.dark .aryn-bb-session-surface',
  '[data-bb-plugin-root]',
  '.dark [data-bb-plugin-root]',
]

function isInsideKeyframes(rule) {
  let parent = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && parent.name.toLowerCase().endsWith('keyframes')) return true
    parent = parent.parent
  }
  return false
}

const unscoped = []
postcss.parse(css).walkRules((rule) => {
  if (isInsideKeyframes(rule)) return
  for (const selector of rule.selectors) {
    const value = selector.trim()
    if (!allowedStarts.some((prefix) => value.startsWith(prefix))) unscoped.push(value)
  }
})

if (unscoped.length > 0) {
  throw new Error(`Unscoped bb selectors:\n${[...new Set(unscoped)].slice(0, 30).join('\n')}`)
}

if (!css.includes('.aryn-bb-session-surface')) {
  throw new Error('Built bb stylesheet does not contain the surface scope')
}

console.log('Verified bb session surface CSS isolation.')
