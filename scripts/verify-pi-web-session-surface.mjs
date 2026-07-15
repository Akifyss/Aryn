import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { verifyPiWebUpstreamProvenance } from './pi-web-upstream-provenance.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = path.join(root, 'packages', 'pi-web-session-surface')
const upstreamRoot = path.join(packageRoot, 'src', 'upstream', 'pi-web')

await verifyPiWebUpstreamProvenance(upstreamRoot)

const css = await readFile(path.join(packageRoot, 'dist', 'style.css'), 'utf8')
const cssRoot = postcss.parse(css, { from: path.join(packageRoot, 'dist', 'style.css') })
const surfaceSelector = '.aryn-pi-web-session-surface'

function isInsideKeyframes(node) {
  let parent = node.parent
  while (parent) {
    if (parent.type === 'atrule' && parent.name.toLowerCase().endsWith('keyframes')) return true
    parent = parent.parent
  }
  return false
}

cssRoot.walkRules((rule) => {
  if (isInsideKeyframes(rule)) return
  for (const selector of rule.selectors) {
    if (!selector.includes(surfaceSelector)) {
      throw new Error(`Unscoped pi-web CSS selector detected: ${selector}`)
    }
  }
})

const forbidden = [
  /(^|[},])\s*(?:html|body|:root|\*)\s*(?:,|\{)/m,
  /(^|})\s*\.markdown-body\b/m,
  /(^|})\s*pre\s*(?:,|\{)/m,
  /(^|})\s*code\s*(?:,|\{)/m,
  /::view-transition-(?:old|new)\(root\)/,
]
for (const pattern of forbidden) {
  if (pattern.test(css)) throw new Error(`Unscoped pi-web CSS detected: ${pattern}`)
}
if (!css.includes(surfaceSelector)) {
  throw new Error('pi-web surface CSS does not contain its scope root.')
}
if (/\.aryn-pi-web-session-surface\{[^}]*height:100(?:%|dvh)/.test(css)) {
  throw new Error('pi-web document viewport height leaked onto the embedded surface root.')
}
if (/@keyframes\s+(?!aryn-pi-web-)/.test(css)) {
  throw new Error('pi-web surface contains an un-namespaced keyframe.')
}
for (const atRule of ['layer', 'theme', 'property', 'font-face']) {
  if (new RegExp(`@${atRule}\\b`).test(css)) {
    throw new Error(`Global CSS registry leaked into pi-web surface: @${atRule}`)
  }
}

const distRoot = path.join(packageRoot, 'dist')
const distEntries = await readdir(distRoot, { recursive: true, withFileTypes: true })
for (const entry of distEntries) {
  if (!entry.isFile() || !entry.name.endsWith('.js')) continue
  const filePath = path.join(entry.parentPath ?? entry.path, entry.name)
  const source = await readFile(filePath, 'utf8')
  const forbiddenNodeGlobals = [
    /\bprocess\.env\b/,
    /\bprocess\.cwd\b/,
  ]
  for (const pattern of forbiddenNodeGlobals) {
    if (pattern.test(source)) {
      throw new Error(`Node global leaked into pi-web renderer bundle: ${path.relative(distRoot, filePath)} (${pattern})`)
    }
  }
  for (const line of source.split(/\r?\n/)) {
    if (/\bprocess\.platform\b/.test(line) && !/typeof process/.test(line)) {
      throw new Error(`Unguarded process.platform leaked into pi-web renderer bundle: ${path.relative(distRoot, filePath)}`)
    }
  }
}
