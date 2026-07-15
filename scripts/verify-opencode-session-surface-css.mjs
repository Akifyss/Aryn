import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cssPath = path.join(rootPath, 'packages', 'opencode-session-surface', 'dist', 'style.css')
const css = await readFile(cssPath, 'utf8')
const root = postcss.parse(css, { from: cssPath })
const unscopedSelectors = []
const doubleScopedNestedSelectors = []
const unsafePortalSelectors = []
const unreachableDocumentRoots = []
const nonNamespacedKeyframes = new Set()
const nonNamespacedLayers = new Set()
const nonNamespacedProperties = new Set()
const nonNamespacedFontFamilies = new Set()

function isInsideKeyframes(rule) {
  let parent = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && parent.name?.toLowerCase().endsWith('keyframes')) return true
    parent = parent.parent
  }
  return false
}

function hasScopedAncestor(rule) {
  let parent = rule.parent
  while (parent) {
    if (parent.type === 'rule' && (
      parent.selector?.includes('.aryn-opencode-session-surface')
      || parent.selector?.includes('.aryn-opencode-portal-theme')
    )) return true
    parent = parent.parent
  }
  return false
}

root.walkRules((rule) => {
  if (isInsideKeyframes(rule)) return
  for (const selector of rule.selectors ?? []) {
    const scoped = selector.includes('.aryn-opencode-session-surface')
      || selector.includes('.aryn-opencode-portal-theme')
      || hasScopedAncestor(rule)
    if (!scoped) unscopedSelectors.push(selector)
    if (
      selector.includes('.aryn-opencode-portal-theme')
      && !/body\s*>\s*\.aryn-opencode-portal-theme/.test(selector)
    ) {
      unsafePortalSelectors.push(selector)
    }
    if (hasScopedAncestor(rule) && (
      selector.includes('.aryn-opencode-session-surface')
      || selector.includes('.aryn-opencode-portal-theme')
    )) {
      doubleScopedNestedSelectors.push(selector)
    }
    if (/\.aryn-opencode-(?:session-surface|portal-theme)\s+(?::root|:host|html(?:\W|$)|body(?:\W|$))/.test(selector)) {
      unreachableDocumentRoots.push(selector)
    }
  }
})

root.walkAtRules((rule) => {
  const name = rule.name.toLowerCase()
  if (name.endsWith('keyframes') && !rule.params.startsWith('aryn-opencode-')) {
    nonNamespacedKeyframes.add(rule.params)
  }
  if (name === 'layer') {
    for (const layer of rule.params.split(',').map((value) => value.trim()).filter(Boolean)) {
      if (!layer.startsWith('aryn-opencode.')) nonNamespacedLayers.add(layer)
    }
  }
  if (name === 'property' && !rule.params.startsWith('--aryn-opencode-')) {
    nonNamespacedProperties.add(rule.params)
  }
  if (name === 'font-face') {
    rule.walkDecls('font-family', (declaration) => {
      const family = declaration.value.trim().replace(/^(?:"([^"]+)"|'([^']+)')$/, '$1$2')
      if (!family.startsWith('aryn-opencode-')) nonNamespacedFontFamilies.add(family)
    })
  }
})

const failures = {
  doubleScopedNestedSelectors: doubleScopedNestedSelectors.slice(0, 10),
  nonNamespacedFontFamilies: [...nonNamespacedFontFamilies],
  nonNamespacedKeyframes: [...nonNamespacedKeyframes],
  nonNamespacedLayers: [...nonNamespacedLayers],
  nonNamespacedProperties: [...nonNamespacedProperties],
  unreachableDocumentRoots: unreachableDocumentRoots.slice(0, 10),
  unscopedSelectors: unscopedSelectors.slice(0, 10),
  unsafePortalSelectors: unsafePortalSelectors.slice(0, 10),
}
const failed = Object.values(failures).some((items) => items.length > 0)
if (failed) {
  throw new Error(`OpenCode surface CSS isolation failed:\n${JSON.stringify(failures, null, 2)}`)
}

console.log(`Verified isolated OpenCode surface CSS (${Buffer.byteLength(css)} bytes).`)
